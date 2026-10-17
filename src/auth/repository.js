import { transaction } from "../source-truth/repository.js";
import { contextualDatabase } from "./database.js";
const kinds = [
  "accounts",
  "sessions",
  "credentials",
  "grants",
  "spaces",
  "applications",
  "programs",
  "notifications",
  "bindings",
  "attempts",
];
const empty = () => Object.fromEntries(kinds.map((kind) => [kind, {}]));
export class AuthRepository {
  constructor(database) {
    this.database = contextualDatabase(database);
  }
  async read(tx = this.database) {
    const control = (await tx.query("SELECT * FROM auth_control WHERE singleton")).rows[0];
    const state = { ...empty(), control, audit: [] };
    for (const row of (await tx.query("SELECT kind,id,payload FROM auth_record")).rows)
      state[row.kind][row.id] = row.payload;
    return state;
  }
  async change(work, workspaceId = null) {
    return transaction(this.database, async (tx) => {
      if (workspaceId) await tx.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [workspaceId]);
      // All authorization mutations serialize here, after project locks. Publication
      // takes the same lock in its existing transaction, so revocation has a commit order.
      await tx.query("SELECT singleton FROM auth_control WHERE singleton FOR UPDATE");
      const state = await this.read(tx),
        before = structuredClone(state);
      const result = await work(state, tx);
      for (const kind of kinds) {
        for (const [id, payload] of Object.entries(state[kind])) {
          if (JSON.stringify(payload) !== JSON.stringify(before[kind][id]))
            await tx.query(
              "INSERT INTO auth_record(kind,id,payload) VALUES($1,$2,$3) ON CONFLICT(kind,id) DO UPDATE SET payload=EXCLUDED.payload",
              [kind, id, JSON.stringify(payload)],
            );
        }
        for (const id of Object.keys(before[kind]))
          if (!state[kind][id]) await tx.query("DELETE FROM auth_record WHERE kind=$1 AND id=$2", [kind, id]);
      }
      for (const event of state.audit)
        await tx.query("INSERT INTO auth_audit(actor_id,event_type,workspace_id,payload) VALUES($1,$2,$3,$4)", [
          event.actorId,
          event.type,
          event.workspaceId ?? null,
          JSON.stringify(event),
        ]);
      await tx.query(
        "UPDATE auth_control SET initialized=$1,recovery=$2,epoch=$3,revision=revision+1 WHERE singleton",
        [state.control.initialized, state.control.recovery, state.control.epoch],
      );
      return result;
    });
  }
  async audit(workspaceId = null) {
    return (
      await this.database.query(
        "SELECT * FROM auth_audit WHERE ($1::text IS NULL OR workspace_id=$1) ORDER BY sequence",
        [workspaceId],
      )
    ).rows;
  }
}
