import pg from "pg";

const { Client } = pg;

export async function connectPostgresDatabase({
  connectionString,
  ssl = false,
  applicationName = "traqen",
  ClientClass = Client,
} = {}) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw new TypeError("connectionString must be a non-empty string");
  }
  const client = new ClientClass({ connectionString, ssl, application_name: applicationName });
  await client.connect();
  let closed = false;
  return Object.freeze({
    query(sql, parameters) {
      if (closed) throw new Error("PostgreSQL connection is closed");
      return client.query(sql, parameters);
    },
    async exec(sql) {
      if (closed) throw new Error("PostgreSQL connection is closed");
      await client.query(sql);
    },
    async close() {
      if (closed) return;
      closed = true;
      await client.end();
    },
  });
}
