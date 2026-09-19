import postgres from "postgres";
import { DATABASE_URL } from "../config.ts";

let sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!sql) {
    sql = postgres(DATABASE_URL, { max: 5 });
  }
  return sql;
}

export async function closeDb() {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
  }
}
