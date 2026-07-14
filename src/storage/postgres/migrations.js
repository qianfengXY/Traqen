import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const migrationName = /^(\d{4}_[a-z0-9_]+)\.sql$/;

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function loadMigrations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && migrationName.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const id = migrationName.exec(name)[1];
      const sql = await readFile(path.join(directory, name), "utf8");
      return Object.freeze({ id, name, sql, checksum: checksum(sql) });
    }),
  );
}

export async function applyMigrations(database, directory) {
  if (typeof database?.exec !== "function" || typeof database?.query !== "function") {
    throw new TypeError("database must provide exec(sql) and query(sql, params?) methods");
  }

  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrations = await loadMigrations(directory);
  const appliedResult = await database.query("SELECT id, checksum FROM schema_migration ORDER BY id");
  const applied = new Map(appliedResult.rows.map((row) => [row.id, row.checksum]));
  const newlyApplied = [];

  for (const migration of migrations) {
    const appliedChecksum = applied.get(migration.id);
    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== migration.checksum) {
        throw new Error(`Applied migration ${migration.id} has changed`);
      }
      continue;
    }

    const migrationId = migration.id.replaceAll("'", "''");
    const migrationChecksum = migration.checksum.replaceAll("'", "''");
    await database.exec(`
      BEGIN;
      ${migration.sql}
      INSERT INTO schema_migration (id, checksum) VALUES ('${migrationId}', '${migrationChecksum}');
      COMMIT;
    `);
    newlyApplied.push(migration.id);
  }

  return Object.freeze(newlyApplied);
}
