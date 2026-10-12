import { rows, write, transaction } from "./db/index.js";
import { today, dueDate, discounted, money } from "./domain.js";
import { queueMail, flushMail } from "./mail.js";
export async function generateCharges() {
  const day = today(),
    period = day.slice(0, 7);
  await transaction(async (db) => {
    const enrolled = await rows(
      "SELECT e.*,c.monthly_cents,c.start_date,c.end_date,c.name AS commission_name,co.name AS course_name,i.settings FROM enrollments e JOIN commissions c ON c.institute_id=e.institute_id AND c.id=e.commission_id JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id JOIN people p ON p.institute_id=e.institute_id AND p.id=e.person_id JOIN institutes i ON i.id=e.institute_id WHERE i.active=1 AND p.active=1 AND c.active=1 AND co.active=1 AND e.billing_start<=? AND c.start_date<=? AND c.end_date>=?",
      [period + "-01", day, period + "-01"],
      db,
    );
    for (const e of enrolled) {
      const settings =
        typeof e.settings === "string" ? JSON.parse(e.settings) : e.settings;
      const amount = discounted(
        Number(e.monthly_cents),
        Number(e.discount_percent),
      );
      if (amount)
        await write(
          "INSERT IGNORE INTO charges(institute_id,person_id,enrollment_id,kind,period,description,cents,due_date) VALUES (?,?,?,'monthly',?,?,?,?)",
          [
            e.institute_id,
            e.person_id,
            e.id,
            period,
            `Cuota ${period} · ${e.course_name} / ${e.commission_name}`,
            amount,
            dueDate(period, settings.dueDay ?? 10),
          ],
          db,
        );
    }
    const institutes = await rows(
      "SELECT * FROM institutes WHERE active=1 AND monthly_cents>0",
      [],
      db,
    );
    for (const i of institutes)
      await write(
        "INSERT IGNORE INTO platform_charges(institute_id,description,period,cents,due_date) VALUES (?,?,?,?,?)",
        [
          i.id,
          `Abono de AulaNexo · ${period}`,
          period,
          i.monthly_cents,
          dueDate(period, i.due_day),
        ],
        db,
      );
  });
}
export async function reminders() {
  const day = today();
  const data = await rows(
    "SELECT c.*,p.user_id,p.email,i.name AS institute_name,i.settings FROM charges c JOIN people p ON p.institute_id=c.institute_id AND p.id=c.person_id JOIN institutes i ON i.id=c.institute_id WHERE c.status='pending' AND c.due_date<? AND i.active=1 AND p.active=1",
    [day],
  );
  for (const c of data) {
    const settings =
      typeof c.settings === "string" ? JSON.parse(c.settings) : c.settings;
    if (!settings.automaticReminders) continue;
    const elapsed = Math.floor(
      (Date.parse(day) - Date.parse(c.due_date)) / 86400000,
    );
    if (elapsed < 1 || (elapsed - 1) % 7 !== 0) continue;
    await transaction(async (db) => {
      const key = `debt:${c.id}:${day}`;
      if (
        !(
          await write(
            "INSERT IGNORE INTO job_markers(dedupe_key) VALUES (?)",
            [key],
            db,
          )
        ).affectedRows
      )
        return;
      const body = `Tenés pendiente ${c.description}: ${money(c.cents)}, vencimiento ${c.due_date}. Contactá al administrador para coordinar el pago.`;
      if (c.email)
        await queueMail(
          c.email,
          `Recordatorio de deuda · ${c.institute_name}`,
          body,
          db,
          key,
        );
      if (
        c.user_id &&
        (
          await rows(
            "SELECT id FROM memberships WHERE institute_id=? AND user_id=? AND status='approved'",
            [c.institute_id, c.user_id],
            db,
          )
        ).length
      ) {
        const nid = (
          await write(
            "INSERT INTO notifications(institute_id,title,body) VALUES (?,?,?)",
            [c.institute_id, "Recordatorio de deuda", body],
            db,
          )
        ).insertId;
        await write(
          "INSERT INTO notification_recipients(institute_id,notification_id,user_id) VALUES (?,?,?)",
          [c.institute_id, nid, c.user_id],
          db,
        );
      }
    });
  }
}
let running = false;
export async function runJobs() {
  if (running) return;
  running = true;
  const connection = await (await import("./db/index.js")).pool.getConnection();
  try {
    const [lock] = await connection.query<any[]>(
      "SELECT GET_LOCK('aulanexo_jobs',0) AS acquired",
    );
    if (!lock[0]?.acquired) return;
    await generateCharges();
    await reminders();
    await write("DELETE FROM sessions WHERE expires_at<UTC_TIMESTAMP()");
    await flushMail();
  } catch (error) {
    console.error(
      "Error en tareas periódicas",
      error instanceof Error ? error.message : "Error",
    );
  } finally {
    await connection.query("SELECT RELEASE_LOCK('aulanexo_jobs')");
    connection.release();
    running = false;
  }
}
