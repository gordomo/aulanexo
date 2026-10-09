import { Router } from "express";
import { rows, write, transaction, audit } from "../db/index.js";
import { csrf } from "../security.js";
import { id, date, text, option, InputError } from "../domain.js";
import { form, page } from "../ui.js";
import { accessibleCommission } from "./institute.js";
export const attendance = Router({ mergeParams: true });
attendance.get("/", async (req, res) => {
  const t = res.locals.tenantId,
    r = res.locals.membership.role,
    u = res.locals.user.id;
  let sql =
    "SELECT l.*,c.name AS commission_name,co.name AS course_name FROM lessons l JOIN commissions c ON c.institute_id=l.institute_id AND c.id=l.commission_id JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id WHERE l.institute_id=?";
  const values: any[] = [t];
  if (r !== "admin") {
    sql +=
      r === "teacher"
        ? " AND EXISTS(SELECT 1 FROM teaching a JOIN people p ON p.institute_id=a.institute_id AND p.id=a.person_id WHERE a.institute_id=c.institute_id AND a.commission_id=c.id AND p.user_id=? AND p.active=1)"
        : " AND EXISTS(SELECT 1 FROM enrollments a JOIN people p ON p.institute_id=a.institute_id AND p.id=a.person_id WHERE a.institute_id=c.institute_id AND a.commission_id=c.id AND p.user_id=? AND p.active=1)";
    values.push(u);
  }
  if (req.query.commission) {
    sql += " AND l.commission_id=?";
    values.push(id(req.query.commission));
  }
  const data = await rows(sql + " ORDER BY l.starts_at DESC", values);
  page(
    res,
    "Asistencias",
    ["Clase", "Curso / comisión", "Acción"],
    data.map((l) => [
      l.starts_at,
      `${l.course_name} · ${l.commission_name}`,
      [
        {
          label: r === "student" ? "Consultar" : "Consultar / registrar",
          href: `${res.locals.base}/attendance/${l.id}`,
        },
      ],
    ]),
    {
      actions:
        r === "student"
          ? []
          : [
              {
                label: "Crear clase",
                href: res.locals.base + "/attendance/new",
              },
            ],
    },
  );
});
attendance.get("/new", async (_req, res) => {
  if (res.locals.membership.role === "student") {
    res.sendStatus(403);
    return;
  }
  const t = res.locals.tenantId,
    r = res.locals.membership.role;
  const data = await rows(
    "SELECT c.id,c.name,co.name AS course_name FROM commissions c JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id WHERE c.institute_id=? AND c.active=1 AND co.active=1" +
      (r === "teacher"
        ? " AND EXISTS(SELECT 1 FROM teaching a JOIN people p ON p.institute_id=a.institute_id AND p.id=a.person_id WHERE a.institute_id=c.institute_id AND a.commission_id=c.id AND p.user_id=? AND p.active=1)"
        : ""),
    r === "teacher" ? [t, res.locals.user.id] : [t],
  );
  form(
    res,
    "Crear clase",
    [
      {
        name: "commission",
        label: "Comisión",
        options: data.map((c) => ({
          value: c.id,
          label: `${c.course_name} · ${c.name}`,
        })),
        required: true,
      },
      { name: "day", label: "Fecha", type: "date", required: true },
      { name: "time", label: "Hora de inicio", type: "time", required: true },
    ],
    {
      description:
        "Para varias clases de una comisión en el mismo día, creá una instancia por horario.",
    },
  );
});
attendance.post("/new", csrf, async (req, res) => {
  if (res.locals.membership.role === "student") {
    res.sendStatus(403);
    return;
  }
  const c = await accessibleCommission(
    res.locals.tenantId,
    id(req.body.commission),
    res.locals.user.id,
    res.locals.membership.role,
  );
  if (!c.active) throw new InputError("La comisión está de baja.");
  const day = date(req.body.day),
    time = text(req.body.time, "Hora", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new InputError("Hora inválida.");
  if (day < c.start_date || day > c.end_date)
    throw new InputError(
      "La clase debe estar dentro de las fechas de la comisión.",
    );
  const result = await write(
    "INSERT INTO lessons(institute_id,commission_id,starts_at) VALUES (?,?,?)",
    [res.locals.tenantId, c.id, `${day} ${time}:00`],
  );
  res.redirect(`${res.locals.base}/attendance/${result.insertId}`);
});
attendance.get("/:id", async (req, res) => {
  const t = res.locals.tenantId,
    l = (
      await rows("SELECT * FROM lessons WHERE institute_id=? AND id=?", [
        t,
        id(req.params.id),
      ])
    )[0];
  if (!l) {
    res.sendStatus(404);
    return;
  }
  const c = await accessibleCommission(
    t,
    l.commission_id,
    res.locals.user.id,
    res.locals.membership.role,
  );
  const student = res.locals.membership.role === "student";
  const data = await rows(
    "SELECT p.id,p.first_name,p.last_name,a.present FROM enrollments e JOIN people p ON p.institute_id=e.institute_id AND p.id=e.person_id LEFT JOIN attendance a ON a.institute_id=e.institute_id AND a.lesson_id=? AND a.person_id=p.id WHERE e.institute_id=? AND e.commission_id=?" +
      (student ? " AND p.user_id=?" : " AND p.active=1") +
      " ORDER BY p.last_name",
    student ? [l.id, t, c.id, res.locals.user.id] : [l.id, t, c.id],
  );
  if (student) {
    page(
      res,
      `Asistencia: ${l.starts_at}`,
      ["Alumno", "Estado"],
      data.map((p) => [
        `${p.first_name} ${p.last_name}`,
        p.present === null
          ? "Sin registrar"
          : p.present
            ? "Presente"
            : "Ausente",
      ]),
    );
    return;
  }
  form(
    res,
    `${c.course_name} · ${c.name}: ${l.starts_at}`,
    data.map((p) => ({
      name: `attendance_${p.id}`,
      label: `${p.last_name}, ${p.first_name}`,
      options: [
        { value: "", label: "Seleccionar" },
        { value: "present", label: "Presente" },
        { value: "absent", label: "Ausente" },
      ],
      value: p.present === null ? "" : p.present ? "present" : "absent",
      required: true,
    })),
    {
      description:
        "Seleccioná un estado para cada alumno. Podés corregir registros anteriores; los cambios quedan auditados.",
      button: "Guardar asistencias",
    },
  );
});
attendance.post("/:id", csrf, async (req, res) => {
  if (res.locals.membership.role === "student") {
    res.sendStatus(403);
    return;
  }
  const t = res.locals.tenantId,
    lid = id(req.params.id);
  await transaction(async (db) => {
    const l = (
      await rows(
        "SELECT * FROM lessons WHERE institute_id=? AND id=? FOR UPDATE",
        [t, lid],
        db,
      )
    )[0];
    if (!l) throw new InputError("Clase no disponible.");
    await accessibleCommission(
      t,
      l.commission_id,
      res.locals.user.id,
      res.locals.membership.role,
      db,
    );
    const roster = await rows(
      "SELECT p.id FROM enrollments e JOIN people p ON p.institute_id=e.institute_id AND p.id=e.person_id WHERE e.institute_id=? AND e.commission_id=? AND p.active=1",
      [t, l.commission_id],
      db,
    );
    if (!roster.length)
      throw new InputError("No hay alumnos activos inscriptos.");
    const allowed = new Set(roster.map((p) => `attendance_${p.id}`));
    if (
      Object.keys(req.body).some(
        (k) => k.startsWith("attendance_") && !allowed.has(k),
      )
    )
      throw new InputError("El formulario contiene alumnos fuera del curso.");
    for (const p of roster) {
      const present =
        option(req.body[`attendance_${p.id}`], ["present", "absent"]) ===
        "present";
      await write(
        "INSERT INTO attendance(institute_id,lesson_id,person_id,present,updated_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE present=VALUES(present),updated_by=VALUES(updated_by)",
        [t, lid, p.id, present, res.locals.user.id],
        db,
      );
    }
    await audit(
      t,
      res.locals.user.id,
      "attendance.save",
      lid,
      JSON.stringify(
        roster.map((p) => ({
          person: p.id,
          present: req.body[`attendance_${p.id}`] === "present",
        })),
      ),
      db,
    );
  });
  res.redirect(`${res.locals.base}/attendance/${lid}`);
});
