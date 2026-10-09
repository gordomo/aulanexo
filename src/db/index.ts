import mysql, {
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { readFile } from "node:fs/promises";
export type Row = RowDataPacket & Record<string, any>;
export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "db",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionLimit: 10,
  timezone: "Z",
  dateStrings: true,
  decimalNumbers: false,
});
export type DB = Pick<PoolConnection, "execute">;
export async function rows(
  sql: string,
  values: any[] = [],
  db: DB = pool,
): Promise<Row[]> {
  const [result] = await db.execute<Row[]>(sql, values);
  return result;
}
export async function write(sql: string, values: any[] = [], db: DB = pool) {
  const [result] = await db.execute<ResultSetHeader>(sql, values);
  return result;
}
export async function transaction<T>(
  work: (db: PoolConnection) => Promise<T>,
): Promise<T> {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await work(db);
    await db.commit();
    return result;
  } catch (e) {
    await db.rollback();
    throw e;
  } finally {
    db.release();
  }
}
export async function migrate() {
  const db = await pool.getConnection();
  try {
    const [lock] = await db.query<Row[]>(
      "SELECT GET_LOCK('aulanexo_schema', 30) AS acquired",
    );
    if (!lock[0]?.acquired) throw new Error("No se pudo bloquear la migración");
    const sql = await readFile("src/db/schema.sql", "utf8");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
  } finally {
    await db.query("SELECT RELEASE_LOCK('aulanexo_schema')");
    db.release();
  }
}
export async function audit(
  tenant: number | null,
  user: number,
  action: string,
  entity: number | null = null,
  detail: string | null = null,
  db: DB = pool,
) {
  await write(
    "INSERT INTO audit_log(institute_id,user_id,action,entity_id,detail) VALUES (?,?,?,?,?)",
    [tenant, user, action, entity, detail],
    db,
  );
}
