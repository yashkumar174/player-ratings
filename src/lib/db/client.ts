import "server-only";
import postgres from "postgres";
import { SCHEMA_SQL } from "./schema";

// A tiny query interface over two drivers:
//  - DATABASE_URL set  -> postgres.js against Supabase / any Postgres
//  - DATABASE_URL unset -> PGlite, an in-process Postgres stored in .pglite/
// so the app runs locally with zero setup and the SQL is identical.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

const nested = (): never => {
  throw new Error("Nested transactions are not supported");
};

function pgQuery(s: postgres.Sql | postgres.TransactionSql): Pick<Db, "query"> {
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await s.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[],
  };
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // prepare:false keeps us compatible with Supabase's transaction pooler.
    // max:1 because on serverless every instance is its own pool: a burst of
    // 60 requests once spun up enough instances x 5 connections to exhaust
    // the pooler's client limit, and frozen instances hold theirs open.
    const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
    // Serverless cold starts run this concurrently, and parallel
    // "create ... if not exists" can collide in the catalog. A transaction
    // advisory lock makes instances take turns; it releases on commit.
    await sql.begin(async (tx) => {
      await tx.unsafe("select pg_advisory_xact_lock(727274)");
      await tx.unsafe(SCHEMA_SQL);
    });
    return {
      ...pgQuery(sql),
      transaction: (fn) => sql.begin((tx) => fn({ ...pgQuery(tx), transaction: () => nested() })) as Promise<never>,
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR ?? ".pglite");
  await pg.exec(SCHEMA_SQL);
  const liteQuery = (s: Pick<typeof pg, "query">): Pick<Db, "query"> => ({
    query: async <T>(text: string, params: unknown[] = []) => (await s.query<T>(text, params)).rows,
  });
  return {
    ...liteQuery(pg),
    transaction: (fn) => pg.transaction((tx) => fn({ ...liteQuery(tx), transaction: () => nested() })),
  };
}

const globalForDb = globalThis as unknown as { __db?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__db ??= connect().catch((err) => {
    globalForDb.__db = undefined; // let the next request retry
    throw err;
  });
  return globalForDb.__db;
}
