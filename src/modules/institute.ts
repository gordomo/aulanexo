import { instituteDashboard } from "./dashboard.js";
import { Router } from "express";
import { authenticated, tenant, admin, csrf } from "../security.js";
import { rows, write, transaction, audit, type DB } from "../db/index.js";
import {
  id,
  text,
  email,
  integer,
  date,
  cents,
  option,
  InputError,
  money,
  today,
  nextBillingMonth,
} from "../domain.js";
import { form, page, roles, roleLabel, type Field } from "../ui.js";
import { queueMail, publicUrl } from "../mail.js";
export const institute = Router({ mergeParams: true });
institute.use(authenticated, tenant);
export async function accessibleCommission(
  tenantId: number,
  commissionId: number,
  userId: number,
  role: string,
  db?: DB,
) {
  const params: any[] = [tenantId, commissionId];
  let clause = "";
  if (role !== "admin") {
    clause =
      role === "teacher"
        ? " AND EXISTS(SELECT 1 FROM teaching t JOIN people p ON p.institute_id=t.institute_id AND p.id=t.person_id WHERE t.institute_id=c.institute_id AND t.commission_id=c.id AND p.user_id=? AND p.active=1)"
        : " AND EXISTS(SELECT 1 FROM enrollments e JOIN people p ON p.institute_id=e.institute_id AND p.id=e.person_id WHERE e.institute_id=c.institute_id AND e.commission_id=c.id AND p.user_id=? AND p.active=1)";
    params.push(userId);
  }
  const c = (
    await rows(
      "SELECT c.*,co.name AS course_name FROM commissions c JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id WHERE c.institute_id=? AND c.id=?" +
        clause,
      params,
      db,
    )
  )[0];
  if (!c) throw new InputError("Comisión no disponible para tu cuenta.");
  return c;
}
institute.get("/", async (_req, res) => {
  const t = res.locals.tenantId,
    r = res.locals.membership.role,
    b = res.locals.base;
  if (r === "admin") {
    await instituteDashboard(res);
    return;
  }
  const notices = (
    await rows(
      "SELECT COUNT(*) AS total FROM notification_recipients WHERE institute_id=? AND user_id=? AND read_at IS NULL",
      [t, res.locals.user.id],
    )
  )[0].total;
  page(
    res,
    res.locals.membership.institute_name,
    ["Sección", "Qué podés hacer", "Acceso"],
    [
      [
        "Cursos y comisiones",
        r === "admin"
          ? "Crear cursos, administrar comisiones e inscribir alumnos"
          : "Consultar tus cursos",
        [{ label: "Abrir", href: b + "/commissions" }],
      ],
      [
        "Asistencias",
        r === "student"
          ? "Consultar tus asistencias"
          : "Registrar y consultar asistencia por clase",
        [{ label: "Abrir", href: b + "/attendance" }],
      ],
      [
        "Pagos",
        r === "admin"
          ? "Gestionar cargos, registrar cobros y emitir recibos"
          : r === "student"
            ? "Consultar tus cuotas y recibos"
            : "Disponible para alumnos y administradores",
        r === "teacher" ? [] : [{ label: "Abrir", href: b + "/payments" }],
      ],
      [
        "Notificaciones",
        `${notices} sin leer`,
        [{ label: "Abrir", href: b + "/notifications" }],
      ],
      [
        "Ayuda",
        "Manual paso a paso según tu rol",
        [{ label: "Consultar", href: b + "/help" }],
      ],
    ],
    {
      description: `Accediste como ${roleLabel(r)}.`,
      actions:
        r === "admin"
          ? [
              { label: "Alumnos", href: b + "/people/student" },
              { label: "Profesores", href: b + "/people/teacher" },
              { label: "Usuarios y roles", href: b + "/users" },
              { label: "Configuración", href: b + "/settings" },
              { label: "Cobros de AulaNexo", href: b + "/subscription" },
            ]
          : r === "student"
            ? [{ label: "Mis datos", href: b + "/profile" }]
            : [],
    },
  );
});
institute.get("/users", admin, async (_req, res) => {
  const data = await rows(
    "SELECT m.*,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.institute_id=? ORDER BY m.status,u.name",
    [res.locals.tenantId],
  );
  page(
    res,
    "Usuarios y roles",
    ["Nombre", "Correo", "Rol", "Estado", "Acciones"],
    data.map((u) => [
      u.name,
      u.email,
      roleLabel(u.role),
      u.status,
      [{ label: "Administrar", href: `${res.locals.base}/users/${u.id}` }],
    ]),
    {
      description: `Los roles son fijos. Cada usuario tiene un rol por instituto. Enlace para solicitar acceso: ${publicUrl()}/register/${(await rows("SELECT slug FROM institutes WHERE id=?", [res.locals.tenantId]))[0].slug}`,
    },
  );
});
institute.get("/users/:id", admin, async (req, res) => {
  const u = (
    await rows(
      "SELECT m.*,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.institute_id=? AND m.id=?",
      [res.locals.tenantId, id(req.params.id)],
    )
  )[0];
  if (!u) {
    res.sendStatus(404);
    return;
  }
  form(
    res,
    `Acceso de ${u.name}`,
    [
      {
        name: "role",
        label: "Rol en este instituto",
        options: roles,
        value: u.role,
        required: true,
      },
      {
        name: "status",
        label: "Estado",
        options: [
          { value: "approved", label: "Aprobar / habilitar" },
          { value: "rejected", label: "Rechazar" },
          { value: "inactive", label: "Deshabilitar" },
        ],
        value: u.status,
        required: true,
      },
    ],
    {
      description: `${u.email}. Administradores: gestión completa. Profesores: sus cursos y asistencias. Alumnos: sus datos, cursos, asistencias y pagos. Siempre debe quedar un administrador habilitado.`,
    },
  );
});
institute.post("/users/:id", admin, csrf, async (req, res) => {
  const role = option(req.body.role, ["admin", "teacher", "student"]),
    status = option(req.body.status, ["approved", "rejected", "inactive"]),
    t = res.locals.tenantId;
  await transaction(async (db) => {
    await rows("SELECT id FROM institutes WHERE id=? FOR UPDATE", [t], db);
    const u = (
      await rows(
        "SELECT m.*,u.email,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.institute_id=? AND m.id=? FOR UPDATE",
        [t, id(req.params.id)],
        db,
      )
    )[0];
    if (!u) throw new InputError("Usuario no disponible.");
    if (
      u.role === "admin" &&
      u.status === "approved" &&
      (role !== "admin" || status !== "approved")
    ) {
      const others = await rows(
        "SELECT id FROM memberships WHERE institute_id=? AND role='admin' AND status='approved' AND id<>?",
        [t, u.id],
        db,
      );
      if (!others.length)
        throw new InputError(
          "Debe quedar al menos un administrador habilitado.",
        );
    }
    await write(
      "UPDATE memberships SET role=?,status=? WHERE institute_id=? AND id=?",
      [role, status, t, u.id],
      db,
    );
    if (status === "approved" && role !== "admin") {
      const p = (
        await rows(
          "SELECT id,user_id FROM people WHERE institute_id=? AND kind=? AND (user_id=? OR (user_id IS NULL AND email=?)) LIMIT 1",
          [t, role === "student" ? "student" : "teacher", u.user_id, u.email],
          db,
        )
      )[0];
      if (p)
        await write(
          "UPDATE people SET user_id=?,active=1 WHERE institute_id=? AND id=?",
          [u.user_id, t, p.id],
          db,
        );
      else {
        const parts = u.name.split(" ");
        await write(
          "INSERT INTO people(institute_id,user_id,kind,first_name,last_name,email) VALUES (?,?,?,?,?,?)",
          [
            t,
            u.user_id,
            role === "student" ? "student" : "teacher",
            parts.shift() || u.name,
            parts.join(" ") || "Sin completar",
            u.email,
          ],
          db,
        );
      }
    }
    await queueMail(
      u.email,
      "Actualización de acceso a AulaNexo",
      `Tu acceso a ${res.locals.membership.institute_name}: ${status === "approved" ? "habilitado" : status === "rejected" ? "rechazado" : "deshabilitado"}. ${status === "approved" ? `Ingresá en ${publicUrl()}/login` : ""}`,
      db,
    );
    await audit(
      t,
      res.locals.user.id,
      "membership.update",
      u.id,
      `${role}/${status}`,
      db,
    );
  });
  res.redirect(res.locals.base + "/users");
});
function personFields(v: any = {}): Field[] {
  return [
    {
      name: "first_name",
      label: "Nombre",
      value: v.first_name,
      required: true,
    },
    {
      name: "last_name",
      label: "Apellido",
      value: v.last_name,
      required: true,
    },
    { name: "email", label: "Correo", type: "email", value: v.email },
    { name: "phone", label: "Teléfono", value: v.phone },
    { name: "dni", label: "DNI", value: v.dni },
    {
      name: "birth_date",
      label: "Fecha de nacimiento",
      type: "date",
      value: v.birth_date,
    },
    { name: "address", label: "Domicilio", value: v.address },
    {
      name: "guardian_name",
      label: "Nombre del responsable",
      value: v.guardian_name,
    },
    {
      name: "guardian_phone",
      label: "Teléfono del responsable",
      value: v.guardian_phone,
    },
    {
      name: "guardian_email",
      label: "Correo del responsable",
      type: "email",
      value: v.guardian_email,
    },
    { name: "notes", label: "Observaciones", type: "textarea", value: v.notes },
  ];
}
function personValues(b: any) {
  return [
    text(b.first_name, "Nombre", 100),
    text(b.last_name, "Apellido", 100),
    email(b.email, false) || null,
    text(b.phone, "Teléfono", 40, false) || null,
    text(b.dni, "DNI", 30, false) || null,
    b.birth_date ? date(b.birth_date) : null,
    text(b.address, "Domicilio", 255, false) || null,
    text(b.guardian_name, "Responsable", 160, false) || null,
    text(b.guardian_phone, "Teléfono responsable", 40, false) || null,
    email(b.guardian_email, false) || null,
    text(b.notes, "Observaciones", 3000, false) || null,
  ];
}
institute.get("/people/:kind", admin, async (req, res) => {
  const kind = option(req.params.kind, ["student", "teacher"]),
    search = text(req.query.q, "Búsqueda", 100, false),
    t = res.locals.tenantId;
  const data = await rows(
    "SELECT * FROM people WHERE institute_id=? AND kind=? AND CONCAT(first_name,' ',last_name,COALESCE(dni,''),COALESCE(email,'')) LIKE ? ORDER BY active DESC,last_name",
    [t, kind, `%${search}%`],
  );
  page(
    res,
    kind === "student" ? "Alumnos" : "Profesores",
    ["Nombre", "DNI", "Correo", "Estado", "Acciones"],
    data.map((p) => [
      `${p.last_name}, ${p.first_name}`,
      p.dni ?? "—",
      p.email ?? "—",
      p.active ? "Activo" : "De baja",
      [
        {
          label: "Editar",
          href: `${res.locals.base}/people/${kind}/${p.id}/edit`,
        },
        {
          label: p.active ? "Dar de baja" : "Reactivar",
          action: `${res.locals.base}/people/${kind}/${p.id}/toggle`,
          confirm: `¿Confirmás ${p.active ? "dar de baja" : "reactivar"} a esta persona? Su historial se conservará.`,
        },
      ],
    ]),
    {
      search: true,
      query: search,
      actions: [
        {
          label: kind === "student" ? "Agregar alumno" : "Agregar profesor",
          href: `${res.locals.base}/people/${kind}/new`,
        },
      ],
    },
  );
});
institute.get("/people/:kind/new", admin, (req, res) => {
  const kind = option(req.params.kind, ["student", "teacher"]);
  form(
    res,
    kind === "student" ? "Agregar alumno" : "Agregar profesor",
    personFields(),
    {
      description:
        "Nombre y apellido son obligatorios. Podés completar los demás datos más adelante.",
    },
  );
});
institute.post("/people/:kind/new", admin, csrf, async (req, res) => {
  const kind = option(req.params.kind, ["student", "teacher"]);
  const v = personValues(req.body);
  const linked = v[2]
    ? (
        await rows(
          "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.institute_id=? AND m.status='approved' AND m.role=? AND u.email=?",
          [
            res.locals.tenantId,
            kind === "student" ? "student" : "teacher",
            v[2],
          ],
        )
      )[0]
    : null;
  const result = await write(
    "INSERT INTO people(institute_id,kind,user_id,first_name,last_name,email,phone,dni,birth_date,address,guardian_name,guardian_phone,guardian_email,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [res.locals.tenantId, kind, linked?.id ?? null, ...v],
  );
  await audit(
    res.locals.tenantId,
    res.locals.user.id,
    "person.create",
    result.insertId,
  );
  res.redirect(`${res.locals.base}/people/${kind}`);
});
institute.get("/people/:kind/:id/edit", admin, async (req, res) => {
  const kind = option(req.params.kind, ["student", "teacher"]);
  const p = (
    await rows(
      "SELECT * FROM people WHERE institute_id=? AND kind=? AND id=?",
      [res.locals.tenantId, kind, id(req.params.id)],
    )
  )[0];
  if (!p) {
    res.sendStatus(404);
    return;
  }
  form(res, "Editar datos", personFields(p));
});
institute.post("/people/:kind/:id/edit", admin, csrf, async (req, res) => {
  const kind = option(req.params.kind, ["student", "teacher"]);
  const result = await write(
    "UPDATE people SET first_name=?,last_name=?,email=?,phone=?,dni=?,birth_date=?,address=?,guardian_name=?,guardian_phone=?,guardian_email=?,notes=? WHERE institute_id=? AND kind=? AND id=?",
    [...personValues(req.body), res.locals.tenantId, kind, id(req.params.id)],
  );
  if (!result.affectedRows) throw new InputError("Persona no disponible.");
  await audit(
    res.locals.tenantId,
    res.locals.user.id,
    "person.update",
    id(req.params.id),
  );
  res.redirect(`${res.locals.base}/people/${kind}`);
});
institute.post("/people/:kind/:id/toggle", admin, csrf, async (req, res) => {
  const kind = option(req.params.kind, ["student", "teacher"]);
  const result = await write(
    "UPDATE people SET active=NOT active WHERE institute_id=? AND kind=? AND id=?",
    [res.locals.tenantId, kind, id(req.params.id)],
  );
  if (!result.affectedRows) throw new InputError("Persona no disponible.");
  await audit(
    res.locals.tenantId,
    res.locals.user.id,
    "person.toggle",
    id(req.params.id),
  );
  res.redirect(`${res.locals.base}/people/${kind}`);
});
institute.get("/profile", async (_req, res) => {
  if (res.locals.membership.role !== "student") {
    res.sendStatus(403);
    return;
  }
  const p = (
    await rows(
      "SELECT * FROM people WHERE institute_id=? AND user_id=? AND kind='student' AND active=1",
      [res.locals.tenantId, res.locals.user.id],
    )
  )[0];
  if (!p)
    throw new InputError(
      "No hay una ficha personal vinculada. Consultá al administrador.",
    );
  page(
    res,
    "Mis datos",
    ["Dato", "Información"],
    personFields(p)
      .filter((f) => f.name !== "notes")
      .map((f) => [f.label, f.value ?? "Sin completar"]),
    {
      description:
        "Para corregir tus datos, contactá al administrador del instituto.",
    },
  );
});
institute.get("/courses", admin, async (_req, res) => {
  const data = await rows(
    "SELECT * FROM courses WHERE institute_id=? ORDER BY active DESC,name",
    [res.locals.tenantId],
  );
  page(
    res,
    "Cursos y niveles",
    ["Curso", "Nivel", "Estado", "Acciones"],
    data.map((c) => [
      c.name,
      c.level,
      c.active ? "Activo" : "De baja",
      [
        { label: "Editar", href: `${res.locals.base}/courses/${c.id}/edit` },
        {
          label: c.active ? "Dar de baja" : "Reactivar",
          action: `${res.locals.base}/courses/${c.id}/toggle`,
          confirm:
            "¿Confirmás cambiar el estado del curso? Se conservará el historial.",
        },
      ],
    ]),
    {
      actions: [
        { label: "Crear curso", href: res.locals.base + "/courses/new" },
      ],
    },
  );
});
const courseFields = (c: any = {}) => [
  { name: "name", label: "Nombre del curso", required: true, value: c.name },
  { name: "level", label: "Nivel", required: true, value: c.level },
];
institute.get("/courses/new", admin, (_req, res) =>
  form(res, "Crear curso", courseFields()),
);
institute.post("/courses/new", admin, csrf, async (req, res) => {
  await write("INSERT INTO courses(institute_id,name,level) VALUES (?,?,?)", [
    res.locals.tenantId,
    text(req.body.name, "Nombre"),
    text(req.body.level, "Nivel", 40),
  ]);
  res.redirect(res.locals.base + "/courses");
});
institute.get("/courses/:id/edit", admin, async (req, res) => {
  const c = (
    await rows("SELECT * FROM courses WHERE institute_id=? AND id=?", [
      res.locals.tenantId,
      id(req.params.id),
    ])
  )[0];
  if (!c) {
    res.sendStatus(404);
    return;
  }
  form(res, "Editar curso", courseFields(c));
});
institute.post("/courses/:id/edit", admin, csrf, async (req, res) => {
  await write(
    "UPDATE courses SET name=?,level=? WHERE institute_id=? AND id=?",
    [
      text(req.body.name, "Nombre"),
      text(req.body.level, "Nivel", 40),
      res.locals.tenantId,
      id(req.params.id),
    ],
  );
  res.redirect(res.locals.base + "/courses");
});
institute.post("/courses/:id/toggle", admin, csrf, async (req, res) => {
  await write(
    "UPDATE courses SET active=NOT active WHERE institute_id=? AND id=?",
    [res.locals.tenantId, id(req.params.id)],
  );
  res.redirect(res.locals.base + "/courses");
});
institute.get("/commissions", async (_req, res) => {
  const t = res.locals.tenantId,
    r = res.locals.membership.role;
  let sql =
    "SELECT c.*,co.name AS course_name FROM commissions c JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id WHERE c.institute_id=?";
  const values: any[] = [t];
  if (r !== "admin") {
    sql +=
      r === "teacher"
        ? " AND EXISTS(SELECT 1 FROM teaching a JOIN people p ON p.institute_id=a.institute_id AND p.id=a.person_id WHERE a.institute_id=c.institute_id AND a.commission_id=c.id AND p.user_id=? AND p.active=1)"
        : " AND EXISTS(SELECT 1 FROM enrollments a JOIN people p ON p.institute_id=a.institute_id AND p.id=a.person_id WHERE a.institute_id=c.institute_id AND a.commission_id=c.id AND p.user_id=? AND p.active=1)";
    values.push(res.locals.user.id);
  }
  const data = await rows(
    sql + " ORDER BY c.academic_year DESC,co.name,c.name",
    values,
  );
  page(
    res,
    r === "admin" ? "Comisiones" : "Mis cursos",
    ["Curso / comisión", "Año", "Horario", "Modalidad", "Estado", "Acciones"],
    data.map((c) => [
      `${c.course_name} · ${c.name}`,
      c.academic_year,
      c.schedule,
      c.modality,
      c.active ? "Activa" : "De baja",
      [{ label: "Consultar", href: `${res.locals.base}/commissions/${c.id}` }],
    ]),
    {
      actions:
        r === "admin"
          ? [
              {
                label: "Crear comisión",
                href: res.locals.base + "/commissions/new",
              },
              { label: "Cursos y niveles", href: res.locals.base + "/courses" },
            ]
          : [],
    },
  );
});
async function commissionFields(t: number, c: any = {}): Promise<Field[]> {
  const courses = await rows(
    "SELECT id,name,level FROM courses WHERE institute_id=? AND (active=1 OR id=?) ORDER BY name",
    [t, c.course_id ?? 0],
  );
  return [
    {
      name: "course_id",
      label: "Curso",
      options: courses.map((i) => ({
        value: i.id,
        label: `${i.name} (${i.level})`,
      })),
      value: c.course_id,
      required: true,
    },
    {
      name: "name",
      label: "Nombre de comisión",
      value: c.name,
      required: true,
    },
    {
      name: "academic_year",
      label: "Año lectivo",
      type: "number",
      min: "2000",
      max: "2100",
      value: c.academic_year ?? Number(today().slice(0, 4)),
      required: true,
    },
    {
      name: "start_date",
      label: "Inicio",
      type: "date",
      value: c.start_date,
      required: true,
    },
    {
      name: "end_date",
      label: "Fin",
      type: "date",
      value: c.end_date,
      required: true,
    },
    {
      name: "schedule",
      label: "Días y horarios",
      value: c.schedule,
      required: true,
      hint: "Ejemplo: lunes y miércoles de 18:00 a 19:30.",
    },
    {
      name: "classroom",
      label: "Aula o enlace de referencia",
      value: c.classroom,
    },
    {
      name: "modality",
      label: "Modalidad",
      options: [
        { value: "presencial", label: "Presencial" },
        { value: "virtual", label: "Virtual" },
        { value: "hibrida", label: "Híbrida" },
      ],
      value: c.modality,
      required: true,
    },
    {
      name: "capacity",
      label: "Cupo",
      type: "number",
      min: "1",
      max: "1000",
      value: c.capacity,
      required: true,
    },
    {
      name: "monthly",
      label: "Cuota mensual (ARS)",
      type: "number",
      min: "0",
      step: "0.01",
      value:
        c.monthly_cents === undefined ? "0" : Number(c.monthly_cents) / 100,
      required: true,
    },
    {
      name: "enrollment",
      label: "Matrícula (ARS)",
      type: "number",
      min: "0",
      step: "0.01",
      value:
        c.enrollment_cents === undefined
          ? "0"
          : Number(c.enrollment_cents) / 100,
      required: true,
    },
  ];
}
function commissionValues(b: any) {
  const start = date(b.start_date),
    end = date(b.end_date);
  if (end < start)
    throw new InputError("La fecha de fin debe ser posterior al inicio.");
  return [
    id(b.course_id),
    text(b.name, "Nombre", 100),
    integer(b.academic_year, "Año", 2000, 2100),
    start,
    end,
    text(b.schedule, "Horario", 255),
    text(b.classroom, "Aula", 100, false),
    option(b.modality, ["presencial", "virtual", "hibrida"]),
    integer(b.capacity, "Cupo", 1, 1000),
    cents(b.monthly),
    cents(b.enrollment),
  ];
}
institute.get("/commissions/new", admin, async (_req, res) =>
  form(res, "Crear comisión", await commissionFields(res.locals.tenantId)),
);
institute.post("/commissions/new", admin, csrf, async (req, res) => {
  const v = commissionValues(req.body);
  if (
    !(
      await rows(
        "SELECT id FROM courses WHERE institute_id=? AND id=? AND active=1",
        [res.locals.tenantId, v[0]],
      )
    ).length
  )
    throw new InputError("Curso no disponible.");
  await write(
    "INSERT INTO commissions(institute_id,course_id,name,academic_year,start_date,end_date,schedule,classroom,modality,capacity,monthly_cents,enrollment_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [res.locals.tenantId, ...v],
  );
  res.redirect(res.locals.base + "/commissions");
});
institute.get("/commissions/:id", async (req, res) => {
  const t = res.locals.tenantId,
    c = await accessibleCommission(
      t,
      id(req.params.id),
      res.locals.user.id,
      res.locals.membership.role,
    ),
    r = res.locals.membership.role,
    b = res.locals.base;
  const teachers = await rows(
    "SELECT p.first_name,p.last_name FROM teaching a JOIN people p ON p.institute_id=a.institute_id AND p.id=a.person_id WHERE a.institute_id=? AND a.commission_id=? AND p.active=1",
    [t, c.id],
  );
  const students =
    r === "student"
      ? []
      : await rows(
          "SELECT p.first_name,p.last_name,p.email,p.active FROM enrollments a JOIN people p ON p.institute_id=a.institute_id AND p.id=a.person_id WHERE a.institute_id=? AND a.commission_id=? ORDER BY p.last_name",
          [t, c.id],
        );
  page(
    res,
    `${c.course_name} · ${c.name}`,
    ["Alumno", "Correo", "Estado"],
    students.map((p) => [
      `${p.last_name}, ${p.first_name}`,
      p.email ?? "—",
      p.active ? "Activo" : "De baja",
    ]),
    {
      description: `${c.start_date} a ${c.end_date} · ${c.schedule} · ${c.modality} · Aula: ${c.classroom || "Sin definir"} · Cupo ${c.capacity} · Cuota ${money(c.monthly_cents)}. Profesores: ${teachers.map((p) => `${p.first_name} ${p.last_name}`).join(", ") || "Sin asignar"}.`,
      actions:
        r === "admin"
          ? [
              {
                label: "Editar comisión",
                href: `${b}/commissions/${c.id}/edit`,
              },
              {
                label: "Inscribir alumno",
                href: `${b}/commissions/${c.id}/enroll`,
              },
              {
                label: "Asignar profesor",
                href: `${b}/commissions/${c.id}/teacher`,
              },
              {
                label: "Asistencias",
                href: `${b}/attendance?commission=${c.id}`,
              },
              {
                label: c.active ? "Dar de baja" : "Reactivar",
                action: `${b}/commissions/${c.id}/toggle`,
                confirm:
                  "¿Confirmás cambiar el estado de la comisión? Su historial se conservará.",
              },
            ]
          : r === "teacher"
            ? [
                {
                  label: "Asistencias",
                  href: `${b}/attendance?commission=${c.id}`,
                },
              ]
            : [],
    },
  );
});
institute.get("/commissions/:id/edit", admin, async (req, res) => {
  const c = await accessibleCommission(
    res.locals.tenantId,
    id(req.params.id),
    res.locals.user.id,
    "admin",
  );
  form(res, "Editar comisión", await commissionFields(res.locals.tenantId, c));
});
institute.post("/commissions/:id/edit", admin, csrf, async (req, res) => {
  const v = commissionValues(req.body),
    t = res.locals.tenantId,
    cid = id(req.params.id);
  await transaction(async (db) => {
    await accessibleCommission(t, cid, res.locals.user.id, "admin", db);
    await rows(
      "SELECT id FROM commissions WHERE institute_id=? AND id=? FOR UPDATE",
      [t, cid],
      db,
    );
    const total = (
      await rows(
        "SELECT COUNT(*) AS total FROM enrollments e WHERE e.institute_id=? AND e.commission_id=?",
        [t, cid],
        db,
      )
    )[0].total;
    if (Number(v[8]) < Number(total))
      throw new InputError(
        "El cupo no puede ser menor a la cantidad de alumnos inscriptos.",
      );
    await write(
      "UPDATE commissions SET course_id=?,name=?,academic_year=?,start_date=?,end_date=?,schedule=?,classroom=?,modality=?,capacity=?,monthly_cents=?,enrollment_cents=? WHERE institute_id=? AND id=?",
      [...v, t, cid],
      db,
    );
  });
  res.redirect(`${res.locals.base}/commissions/${cid}`);
});
institute.post("/commissions/:id/toggle", admin, csrf, async (req, res) => {
  await write(
    "UPDATE commissions SET active=NOT active WHERE institute_id=? AND id=?",
    [res.locals.tenantId, id(req.params.id)],
  );
  res.redirect(`${res.locals.base}/commissions/${id(req.params.id)}`);
});
institute.get("/commissions/:id/enroll", admin, async (req, res) => {
  const commission = await accessibleCommission(
    res.locals.tenantId,
    id(req.params.id),
    res.locals.user.id,
    "admin",
  );
  if (
    Number(commission.monthly_cents) > 0 &&
    (!Number.isInteger(Number(res.locals.settings.dueDay)) ||
      Number(res.locals.settings.dueDay) < 1 ||
      Number(res.locals.settings.dueDay) > 31)
  )
    throw new InputError(
      "Primero configurá el día de vencimiento de cuotas en Configuración del instituto.",
    );
  const people = await rows(
    "SELECT id,first_name,last_name FROM people WHERE institute_id=? AND kind='student' AND active=1 ORDER BY last_name",
    [res.locals.tenantId],
  );
  form(
    res,
    "Inscribir alumno",
    [
      {
        name: "person_id",
        label: "Alumno",
        options: people.map((p) => ({
          value: p.id,
          label: `${p.last_name}, ${p.first_name}`,
        })),
        required: true,
      },
      {
        name: "discount",
        label: "Descuento sobre la cuota mensual (%)",
        type: "number",
        min: "0",
        max: "100",
        value: res.locals.settings.discountPercent ?? 0,
        required: true,
      },
      ...(res.locals.settings.enrollmentEnabled &&
      Number(commission.enrollment_cents) > 0
        ? [
            {
              name: "enrollment_due_date",
              label: "Vencimiento de la matrícula",
              type: "date",
              required: true,
            },
          ]
        : []),
    ],
    {
      description:
        "La cuota comienza el próximo mes. Al confirmar autorizás al alumno a asistir durante el mes actual sin cuota. Si la matrícula está habilitada, se genera al inscribir.",
    },
  );
});
institute.post("/commissions/:id/enroll", admin, csrf, async (req, res) => {
  const t = res.locals.tenantId,
    cid = id(req.params.id),
    pid = id(req.body.person_id),
    discount = integer(req.body.discount, "Descuento", 0, 100);
  await transaction(async (db) => {
    const c = (
      await rows(
        "SELECT c.* FROM commissions c JOIN courses co ON co.institute_id=c.institute_id AND co.id=c.course_id WHERE c.institute_id=? AND c.id=? AND c.active=1 AND co.active=1 FOR UPDATE",
        [t, cid],
        db,
      )
    )[0];
    if (!c || c.end_date < today())
      throw new InputError("Comisión no disponible para inscribir.");
    const p = (
      await rows(
        "SELECT id FROM people WHERE institute_id=? AND id=? AND kind='student' AND active=1",
        [t, pid],
        db,
      )
    )[0];
    if (!p) throw new InputError("Alumno no disponible.");
    if (
      (
        await rows(
          "SELECT id FROM enrollments WHERE institute_id=? AND person_id=? AND commission_id=?",
          [t, pid, cid],
          db,
        )
      ).length
    )
      throw new InputError("El alumno ya está inscripto.");
    const total = (
      await rows(
        "SELECT COUNT(*) AS total FROM enrollments e WHERE e.institute_id=? AND e.commission_id=?",
        [t, cid],
        db,
      )
    )[0].total;
    if (Number(total) >= Number(c.capacity))
      throw new InputError("La comisión no tiene cupos disponibles.");
    const dueDay = Number(res.locals.settings.dueDay);
    if (
      Number(c.monthly_cents) > 0 &&
      (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
    )
      throw new InputError(
        "Configurá el vencimiento de cuotas antes de inscribir alumnos en una comisión con cuota mensual.",
      );
    const enrollmentDueDate =
      res.locals.settings.enrollmentEnabled && Number(c.enrollment_cents) > 0
        ? date(req.body.enrollment_due_date)
        : null;
    const billing = nextBillingMonth(today());
    const result = await write(
      "INSERT INTO enrollments(institute_id,person_id,commission_id,billing_start,discount_percent) VALUES (?,?,?,?,?)",
      [t, pid, cid, billing, discount],
      db,
    );
    if (res.locals.settings.enrollmentEnabled && Number(c.enrollment_cents) > 0)
      await write(
        "INSERT INTO charges(institute_id,person_id,enrollment_id,kind,period,description,cents,due_date) VALUES (?,?,?,'enrollment',?,'Matrícula',?,?)",
        [
          t,
          pid,
          result.insertId,
          today().slice(0, 7),
          c.enrollment_cents,
          enrollmentDueDate,
        ],
        db,
      );
    await audit(
      t,
      res.locals.user.id,
      "enrollment.create",
      result.insertId,
      null,
      db,
    );
  });
  res.redirect(`${res.locals.base}/commissions/${cid}`);
});
institute.get("/commissions/:id/teacher", admin, async (req, res) => {
  await accessibleCommission(
    res.locals.tenantId,
    id(req.params.id),
    res.locals.user.id,
    "admin",
  );
  const people = await rows(
    "SELECT id,first_name,last_name FROM people WHERE institute_id=? AND kind='teacher' AND active=1 ORDER BY last_name",
    [res.locals.tenantId],
  );
  form(
    res,
    "Asignar profesor",
    [
      {
        name: "person_id",
        label: "Profesor",
        options: people.map((p) => ({
          value: p.id,
          label: `${p.last_name}, ${p.first_name}`,
        })),
        required: true,
      },
    ],
    { description: "Una comisión puede tener varios profesores asignados." },
  );
});
institute.post("/commissions/:id/teacher", admin, csrf, async (req, res) => {
  const t = res.locals.tenantId,
    cid = id(req.params.id),
    pid = id(req.body.person_id);
  await accessibleCommission(t, cid, res.locals.user.id, "admin");
  if (
    !(
      await rows(
        "SELECT id FROM people WHERE institute_id=? AND id=? AND kind='teacher' AND active=1",
        [t, pid],
      )
    ).length
  )
    throw new InputError("Profesor no disponible.");
  await write(
    "INSERT INTO teaching(institute_id,person_id,commission_id) VALUES (?,?,?)",
    [t, pid, cid],
  );
  res.redirect(`${res.locals.base}/commissions/${cid}`);
});
institute.get("/settings", admin, (_req, res) => {
  const s = res.locals.settings;
  form(
    res,
    "Configuración del instituto",
    [
      {
        name: "due_day",
        label: "Día de vencimiento de cuotas",
        type: "number",
        min: "1",
        max: "31",
        value: s.dueDay ?? "",
        hint: "Si el mes no tiene ese día, el vencimiento será el último día del mes.",
        required: true,
      },
      {
        name: "discount",
        label: "Descuento por defecto sobre cuotas mensuales (%)",
        type: "number",
        min: "0",
        max: "100",
        value: s.discountPercent ?? 0,
        required: true,
      },
      {
        name: "enrollment_enabled",
        label: "Cobrar matrícula al inscribir",
        options: [
          { value: "yes", label: "Sí" },
          { value: "no", label: "No" },
        ],
        value: s.enrollmentEnabled ? "yes" : "no",
        required: true,
      },
      {
        name: "payment_methods",
        label: "Métodos de pago, uno por línea",
        type: "textarea",
        value: (s.paymentMethods ?? []).join("\n"),
        required: true,
      },
      {
        name: "reminders",
        label: "Recordatorios de deuda automáticos",
        options: [
          { value: "yes", label: "Habilitados" },
          { value: "no", label: "Deshabilitados" },
        ],
        value:
          s.automaticReminders && s.reminderIntervalDays && s.reminderDelayDays
            ? "yes"
            : "no",
        required: true,
      },
      {
        name: "reminder_delay_days",
        label:
          "Enviar el primer recordatorio cuántos días después del vencimiento",
        type: "number",
        min: "1",
        max: "365",
        value: s.reminderDelayDays ?? "",
        hint: "Obligatorio al habilitar recordatorios automáticos.",
      },
      {
        name: "reminder_interval_days",
        label: "Repetir recordatorios cada cuántos días",
        type: "number",
        min: "1",
        max: "365",
        value: s.reminderIntervalDays ?? "",
        hint: "Obligatorio al habilitar recordatorios. Los avisos se repiten con la frecuencia que elijas mientras la deuda siga pendiente.",
      },
    ],
    {
      description:
        "Los cambios se aplican a futuros cargos e inscripciones. Los cargos existentes conservan sus importes y vencimientos.",
    },
  );
});
institute.post("/settings", admin, csrf, async (req, res) => {
  const methods = text(req.body.payment_methods, "Métodos", 1000)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !methods.length ||
    methods.length > 20 ||
    methods.some((m) => m.length > 60)
  )
    throw new InputError("Definí entre 1 y 20 métodos de hasta 60 caracteres.");
  const automaticReminders =
    option(req.body.reminders, ["yes", "no"]) === "yes";
  const reminderIntervalDays = req.body.reminder_interval_days
    ? integer(
        req.body.reminder_interval_days,
        "Frecuencia de recordatorios",
        1,
        365,
      )
    : null;
  const reminderDelayDays = req.body.reminder_delay_days
    ? integer(req.body.reminder_delay_days, "Primer recordatorio", 1, 365)
    : null;
  if (automaticReminders && (!reminderIntervalDays || !reminderDelayDays))
    throw new InputError(
      "Definí el primer aviso y la frecuencia antes de habilitar los recordatorios automáticos.",
    );
  const settings = {
    dueDay: integer(req.body.due_day, "Vencimiento", 1, 31),
    discountPercent: integer(req.body.discount, "Descuento", 0, 100),
    enrollmentEnabled:
      option(req.body.enrollment_enabled, ["yes", "no"]) === "yes",
    paymentMethods: [...new Set(methods)],
    automaticReminders,
    reminderIntervalDays,
    reminderDelayDays,
  };
  await write("UPDATE institutes SET settings=? WHERE id=?", [
    JSON.stringify(settings),
    res.locals.tenantId,
  ]);
  await audit(res.locals.tenantId, res.locals.user.id, "settings.update");
  res.redirect(res.locals.base);
});
institute.get("/subscription", admin, async (_req, res) => {
  const data = await rows(
    "SELECT * FROM platform_charges WHERE institute_id=? ORDER BY due_date DESC",
    [res.locals.tenantId],
  );
  page(
    res,
    "Cobros de AulaNexo",
    ["Concepto", "Importe", "Vencimiento", "Estado", "Fecha de pago"],
    data.map((c) => [
      c.description,
      money(c.cents),
      c.due_date,
      c.status === "paid" ? "Pagado" : "Pendiente",
      c.paid_date ?? "—",
    ]),
    {
      description:
        "Se muestran los cargos efectivamente registrados por el superadministrador, con sus importes y vencimientos. El modelo comercial de AulaNexo está pendiente de definición.",
    },
  );
});
