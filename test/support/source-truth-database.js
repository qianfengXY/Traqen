import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../../src/storage/postgres/migrations.js";
import { SourceTruthRepository } from "../../src/source-truth/repository.js";

export const owner = { actorId: "owner", tenantId: "tenant" };
export const reader = { actorId: "reader", tenantId: "tenant" };

export async function sourceDatabase(t) {
  const db = await PGlite.create();
  t.after(() => db.close());
  await applyMigrations(db, fileURLToPath(new URL("../../db/migrations/", import.meta.url)));
  await db.exec(`INSERT INTO organization (id,name) VALUES ('org','Org');
    INSERT INTO tenant (id,organization_id,name) VALUES ('tenant','org','Tenant'),('other','org','Other');
    INSERT INTO project (id,tenant_id,name) VALUES ('workspace','tenant','Workspace'),('workspace2','other','Other');
    INSERT INTO principal (id,tenant_id,principal_type,display_name) VALUES ('owner','tenant','USER','Owner'),('reader','tenant','USER','Reader');`);
  const repository = new SourceTruthRepository(db);
  await repository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "MAINTAIN" }, { actorId: "reader", role: "READ" }] });
  await repository.provision("workspace2", { tenantId: "other", grants: [] });
  return { db, repository };
}
