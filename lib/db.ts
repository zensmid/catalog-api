import { neon } from "@netlify/neon";

// Singleton SQL client for Netlify DB (Neon Postgres)
let _sql: ReturnType<typeof neon> | null = null;

export function getDB() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

export const sql = new Proxy({} as ReturnType<typeof neon>, {
  get(_, prop) {
    return (getDB() as unknown as Record<string | symbol, unknown>)[prop];
  },
  apply(_, __, args) {
    return (getDB() as unknown as (...a: unknown[]) => unknown)(...args);
  },
});
