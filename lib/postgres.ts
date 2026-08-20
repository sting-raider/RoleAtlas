import "server-only";

import { Pool } from "pg";

const globalPool = globalThis as typeof globalThis & {
  roleAtlasPostgresPool?: Pool;
};

function databaseUrl() {
  return (
    process.env.DATABASE_URL ??
    "postgres://roleatlas:roleatlas@127.0.0.1:5432/roleatlas"
  );
}

export const postgres =
  globalPool.roleAtlasPostgresPool ??
  new Pool({
    connectionString: databaseUrl(),
    max: Number(process.env.WEB_DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "roleatlas-web",
  });

if (process.env.NODE_ENV !== "production") {
  globalPool.roleAtlasPostgresPool = postgres;
}
