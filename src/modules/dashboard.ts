import type { Response } from "express";
import { rows } from "../db/index.js";

export async function instituteDashboard(res: Response) {
  const tenantId = res.locals.tenantId;
  const [summary, commissions, noticeCount] = await Promise.all([
    rows(
      `SELECT
      (SELECT COUNT(*) FROM courses WHERE institute_id=? AND active=1) AS courses,
      (SELECT COUNT(*) FROM commissions c JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id WHERE c.institute_id=? AND c.active=1 AND co.active=1) AS commissions,
      (SELECT COUNT(*) FROM enrollments WHERE institute_id=?) AS enrollments`,
      [tenantId, tenantId, tenantId],
    ),
    rows(
      `SELECT c.id,c.name,c.academic_year,c.schedule,c.capacity,co.name AS course_name,co.level,
      (SELECT COUNT(*) FROM enrollments e WHERE e.institute_id=c.institute_id AND e.commission_id=c.id) AS enrolled
      FROM commissions c JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id
      WHERE c.institute_id=? AND c.active=1 AND co.active=1
      ORDER BY c.academic_year DESC,co.name,c.name,c.id LIMIT 6`,
      [tenantId],
    ),
    rows(
      "SELECT COUNT(*) AS total FROM notification_recipients WHERE institute_id=? AND user_id=? AND read_at IS NULL",
      [tenantId, res.locals.user.id],
    ),
  ]);
  const total = summary[0];
  res.render("dashboard", {
    title: "Inicio",
    metrics: [
      {
        label: "Cursos activos",
        value: total.courses,
        hint: "Los niveles que ofrece tu instituto.",
        href: `${res.locals.base}/courses`,
      },
      {
        label: "Comisiones activas",
        value: total.commissions,
        hint: "Grupos habilitados de cursos activos.",
        href: `${res.locals.base}/commissions`,
      },
      {
        label: "Inscripciones registradas",
        value: total.enrollments,
        hint: "Un alumno puede estar en varias comisiones.",
        href: `${res.locals.base}/commissions`,
      },
    ],
    commissions,
    unreadNotifications: Number(noticeCount[0].total),
    needsConfiguration:
      !Number.isInteger(Number(res.locals.settings.dueDay)) ||
      Number(res.locals.settings.dueDay) < 1 ||
      Number(res.locals.settings.dueDay) > 31,
  });
}
