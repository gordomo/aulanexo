import nodemailer from "nodemailer";
import { rows, write, type DB, pool } from "./db/index.js";
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "mailpit",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: process.env.SMTP_SECURE === "true",
  ...(process.env.SMTP_USER
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
    : {}),
  disableFileAccess: true,
  disableUrlAccess: true,
});
export async function queueMail(
  to: string,
  subject: string,
  body: string,
  db: DB = pool,
  dedupe: string | null = null,
) {
  await write(
    "INSERT IGNORE INTO outbox(recipient,subject,body,dedupe_key) VALUES (?,?,?,?)",
    [to, subject, body, dedupe],
    db,
  );
}
export async function flushMail() {
  const connection = await pool.getConnection();
  try {
    const [lock] = await connection.query<any[]>(
      "SELECT GET_LOCK('aulanexo_mail',0) AS acquired",
    );
    if (!lock[0]?.acquired) return;
    for (const item of await rows(
      "SELECT * FROM outbox WHERE sent_at IS NULL AND available_at<=UTC_TIMESTAMP() AND attempts<10 ORDER BY id LIMIT 20",
      [],
      connection,
    )) {
      try {
        await transport.sendMail({
          from: process.env.MAIL_FROM ?? "AulaNexo <no-reply@aulanexo.test>",
          to: item.recipient,
          subject: item.subject,
          text: item.body,
        });
        await write(
          "UPDATE outbox SET sent_at=UTC_TIMESTAMP() WHERE id=?",
          [item.id],
          connection,
        );
      } catch {
        await write(
          "UPDATE outbox SET attempts=attempts+1,available_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE) WHERE id=?",
          [item.id],
          connection,
        );
        console.error("No se pudo enviar correo pendiente", item.id);
      }
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('aulanexo_mail')");
    connection.release();
  }
}
export const publicUrl = () => {
  const url = new URL(process.env.APP_URL ?? "http://localhost:3100");
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("APP_URL inválida");
  return url.origin;
};
