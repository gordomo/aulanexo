import { requestReview } from "./institute-requests.js";
import { platformHelp } from "../help.js";
import { Router } from "express";
import { authenticated, superAdmin, csrf, token, digest } from "../security.js";
import { rows, write, transaction, audit } from "../db/index.js";
import {
  text,
  email,
  id,
  cents,
  integer,
  date,
  InputError,
  money,
  today,
} from "../domain.js";
import { form, page } from "../ui.js";
import { queueMail, publicUrl } from "../mail.js";
export const platform = Router();
platform.use(authenticated, superAdmin);
platform.use("/requests", requestReview);
platform.get("/help", (_req, res) => platformHelp(res));
platform.get("/", async (_req, res) => {
  const data = await rows(
    "SELECT i.*,COALESCE((SELECT SUM(cents) FROM platform_charges p WHERE p.institute_id=i.id AND p.status='pending'),0) AS balance FROM institutes i ORDER BY name",
  );
  page(
    res,
    "Institutos de AulaNexo",
    [
      "Instituto",
      "Contacto",
      "Plan",
      "Abono mensual",
      "Saldo pendiente",
      "Estado",
      "Acciones",
    ],
    data.map((i) => [
      i.name,
      i.contact_email,
      i.plan,
      money(i.monthly_cents),
      money(i.balance),
      i.active ? "Activo" : "Deshabilitado",
      [{ label: "Administrar", href: `/platform/${i.id}` }],
    ]),
    {
      actions: [
        { label: "Crear instituto", href: "/platform/new" },
        { label: "Solicitudes de acceso", href: "/platform/requests" },
      ],
    },
  );
});
const fields = (v: any = {}) => [
  {
    name: "name",
    label: "Nombre del instituto",
    required: true,
    value: v.name,
  },
  {
    name: "slug",
    label: "Identificador público",
    required: true,
    value: v.slug,
    hint: "Letras minúsculas, números y guiones. Se usa en el enlace de registro.",
  },
  {
    name: "contact_email",
    label: "Correo de contacto",
    type: "email",
    required: true,
    value: v.contact_email,
  },
  { name: "phone", label: "Teléfono", value: v.phone },
  { name: "plan", label: "Plan", required: true, value: v.plan ?? "Estándar" },
  {
    name: "monthly",
    label: "Abono mensual (ARS)",
    type: "number",
    step: "0.01",
    min: "0",
    required: true,
    value:
      v.monthly_cents !== undefined
        ? String(Number(v.monthly_cents) / 100)
        : "0",
  },
  {
    name: "due_day",
    label: "Día de vencimiento",
    type: "number",
    min: "1",
    max: "28",
    required: true,
    value: v.due_day ?? 10,
  },
];
platform.get("/new", async (req, res) => {
  const requestId = req.query.request ? id(req.query.request) : null;
  const request = requestId
    ? (
        await rows(
          "SELECT * FROM institute_requests WHERE id=? AND status='pending'",
          [requestId],
        )
      )[0]
    : null;
  if (requestId && !request)
    throw new InputError("La solicitud ya fue resuelta o no está disponible.");
  const preset = request
    ? {
        name: request.institute_name,
        contact_email: request.email,
        phone: request.phone,
        slug: request.institute_name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 80)
          .replace(/-$/, ""),
      }
    : {};
  form(
    res,
    request ? "Crear instituto y aprobar solicitud" : "Crear instituto",
    [
      ...fields(preset),
      {
        name: "admin_email",
        label: "Correo del primer administrador",
        type: "email",
        required: true,
        value: request?.email,
      },
    ],
    {
      description: request
        ? "Al guardar se aprueba la solicitud, se crea el instituto y se envía la invitación. Definí el plan, el importe mensual y su vencimiento."
        : "El primer administrador recibirá una invitación por correo.",
      hiddenValues: requestId ? { _request_id: requestId } : {},
      backHref: requestId ? `/platform/requests/${requestId}` : "/platform",
    },
  );
});
platform.post("/new", csrf, async (req, res) => {
  const name = text(req.body.name, "Nombre"),
    slug = text(req.body.slug, "Identificador", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new InputError("Identificador inválido.");
  const contact = email(req.body.contact_email),
    adminEmail = email(req.body.admin_email),
    value = token();
  const requestId = req.body._request_id ? id(req.body._request_id) : null;
  const plan = text(req.body.plan, "Plan", 100),
    monthly = cents(req.body.monthly),
    due = integer(req.body.due_day, "Vencimiento", 1, 28);
  let instituteId = 0;
  await transaction(async (db) => {
    const request = requestId
      ? (
          await rows(
            "SELECT * FROM institute_requests WHERE id=? AND status='pending' FOR UPDATE",
            [requestId],
            db,
          )
        )[0]
      : null;
    if (requestId && !request)
      throw new InputError(
        "La solicitud ya fue resuelta o no está disponible.",
      );
    instituteId = (
      await write(
        "INSERT INTO institutes(name,slug,contact_email,phone,plan,monthly_cents,due_day,settings) VALUES (?,?,?,?,?,?,?,?)",
        [
          name,
          slug,
          contact,
          text(req.body.phone, "Teléfono", 40, false),
          plan,
          monthly,
          due,
          JSON.stringify({
            dueDay: 10,
            enrollmentEnabled: true,
            discountPercent: 0,
            paymentMethods: ["Efectivo", "Transferencia"],
            automaticReminders: true,
          }),
        ],
        db,
      )
    ).insertId;
    await write(
      "INSERT INTO access_tokens(token_hash,kind,email,institute_id,role,expires_at) VALUES (?,'invite',?,?,'admin',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))",
      [digest(value), adminEmail, instituteId],
      db,
    );
    await queueMail(
      adminEmail,
      `Invitación a ${name}`,
      `Aceptá tu invitación como administrador: ${publicUrl()}/invite/${value}\nVence en 7 días.\nPlan: ${plan}. Abono mensual: ${money(monthly)}. Vencimiento: día ${due}.`,
      db,
    );
    if (request) {
      await write(
        "UPDATE institute_requests SET status='approved',institute_id=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP() WHERE id=?",
        [instituteId, res.locals.user.id, requestId],
        db,
      );
      await queueMail(
        request.email,
        "Tu solicitud de AulaNexo fue aprobada",
        `Hola ${request.contact_name}. Aprobamos tu solicitud para ${name}. Plan: ${plan}. Abono mensual: ${money(monthly)}. Vencimiento: día ${due}. Enviamos la invitación al primer administrador: ${adminEmail}.`,
        db,
      );
      await audit(
        null,
        res.locals.user.id,
        "institute_request.approve",
        requestId,
        null,
        db,
      );
    }
    await audit(
      null,
      res.locals.user.id,
      "institute.create",
      instituteId,
      null,
      db,
    );
  });
  res.redirect(`/platform/${instituteId}`);
});
platform.get("/:id", async (req, res) => {
  const institute = (
    await rows("SELECT * FROM institutes WHERE id=?", [id(req.params.id)])
  )[0];
  if (!institute) {
    res.sendStatus(404);
    return;
  }
  const charges = await rows(
    "SELECT * FROM platform_charges WHERE institute_id=? ORDER BY due_date DESC",
    [institute.id],
  );
  page(
    res,
    institute.name,
    ["Concepto", "Período", "Importe", "Vencimiento", "Estado", "Acción"],
    charges.map((c) => [
      c.description,
      c.period ?? "—",
      money(c.cents),
      c.due_date,
      c.status === "paid" ? "Pagado" : "Pendiente",
      c.status === "pending"
        ? [
            {
              label: "Registrar cobro",
              href: `/platform/${institute.id}/charges/${c.id}/pay`,
            },
          ]
        : [],
    ]),
    {
      description: `Plan ${institute.plan} · Abono mensual ${money(institute.monthly_cents)} · Vence el día ${institute.due_day}. Registro: ${publicUrl()}/register/${institute.slug}`,
      actions: [
        { label: "Editar instituto", href: `/platform/${institute.id}/edit` },
        {
          label: "Agregar cargo",
          href: `/platform/${institute.id}/charges/new`,
        },
        {
          label: "Invitar administrador",
          href: `/platform/${institute.id}/invite`,
        },
        {
          label: institute.active ? "Deshabilitar" : "Reactivar",
          action: `/platform/${institute.id}/toggle`,
          confirm: "¿Confirmás el cambio de estado del instituto?",
        },
      ],
    },
  );
});
platform.get("/:id/edit", async (req, res) => {
  const v = (
    await rows("SELECT * FROM institutes WHERE id=?", [id(req.params.id)])
  )[0];
  if (!v) {
    res.sendStatus(404);
    return;
  }
  form(res, "Editar instituto", fields(v));
});
platform.post("/:id/edit", csrf, async (req, res) => {
  const slug = text(req.body.slug, "Identificador", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new InputError("Identificador inválido.");
  await write(
    "UPDATE institutes SET name=?,slug=?,contact_email=?,phone=?,plan=?,monthly_cents=?,due_day=? WHERE id=?",
    [
      text(req.body.name, "Nombre"),
      slug,
      email(req.body.contact_email),
      text(req.body.phone, "Teléfono", 40, false),
      text(req.body.plan, "Plan", 100),
      cents(req.body.monthly),
      integer(req.body.due_day, "Vencimiento", 1, 28),
      id(req.params.id),
    ],
  );
  await audit(null, res.locals.user.id, "institute.update", id(req.params.id));
  res.redirect(`/platform/${id(req.params.id)}`);
});
platform.post("/:id/toggle", csrf, async (req, res) => {
  await write("UPDATE institutes SET active=NOT active WHERE id=?", [
    id(req.params.id),
  ]);
  await audit(null, res.locals.user.id, "institute.toggle", id(req.params.id));
  res.redirect(`/platform/${id(req.params.id)}`);
});
platform.get("/:id/invite", (_req, res) =>
  form(res, "Invitar administrador", [
    {
      name: "email",
      label: "Correo electrónico",
      type: "email",
      required: true,
    },
  ]),
);
platform.post("/:id/invite", csrf, async (req, res) => {
  const institute = (
    await rows("SELECT name FROM institutes WHERE id=? AND active=1", [
      id(req.params.id),
    ])
  )[0];
  if (!institute) throw new InputError("Instituto no disponible.");
  const value = token(),
    address = email(req.body.email);
  await transaction(async (db) => {
    await write(
      "UPDATE access_tokens SET used_at=UTC_TIMESTAMP() WHERE kind='invite' AND institute_id=? AND email=? AND used_at IS NULL",
      [id(req.params.id), address],
      db,
    );
    await write(
      "INSERT INTO access_tokens(token_hash,kind,email,institute_id,role,expires_at) VALUES (?,'invite',?,?,'admin',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))",
      [digest(value), address, id(req.params.id)],
      db,
    );
    await queueMail(
      address,
      "Invitación a AulaNexo",
      `Aceptá tu invitación a ${institute.name}: ${publicUrl()}/invite/${value}`,
      db,
    );
  });
  res.redirect(`/platform/${id(req.params.id)}`);
});
platform.get("/:id/charges/new", (_req, res) =>
  form(res, "Agregar cargo al instituto", [
    { name: "description", label: "Concepto", required: true },
    {
      name: "amount",
      label: "Importe (ARS)",
      type: "number",
      min: "0.01",
      step: "0.01",
      required: true,
    },
    { name: "due_date", label: "Vencimiento", type: "date", required: true },
  ]),
);
platform.post("/:id/charges/new", csrf, async (req, res) => {
  const amount = cents(req.body.amount);
  if (amount === 0) throw new InputError("El importe debe ser mayor a cero.");
  await write(
    "INSERT INTO platform_charges(institute_id,description,cents,due_date) VALUES (?,?,?,?)",
    [
      id(req.params.id),
      text(req.body.description, "Concepto", 255),
      amount,
      date(req.body.due_date),
    ],
  );
  await audit(null, res.locals.user.id, "platform.charge", id(req.params.id));
  res.redirect(`/platform/${id(req.params.id)}`);
});
platform.get("/:id/charges/:charge/pay", (_req, res) =>
  form(
    res,
    "Registrar cobro del abono",
    [
      {
        name: "paid_date",
        label: "Fecha de cobro",
        type: "date",
        value: today(),
        required: true,
      },
      { name: "method", label: "Medio de cobro", required: true },
    ],
    {
      button: "Confirmar cobro",
      description: "Se registra el importe completo del cargo seleccionado.",
    },
  ),
);
platform.post("/:id/charges/:charge/pay", csrf, async (req, res) => {
  const result = await write(
    "UPDATE platform_charges SET status='paid',paid_date=?,method=? WHERE id=? AND institute_id=? AND status='pending'",
    [
      date(req.body.paid_date),
      text(req.body.method, "Medio", 60),
      id(req.params.charge),
      id(req.params.id),
    ],
  );
  if (!result.affectedRows)
    throw new InputError("Cargo no disponible para cobrar.");
  await audit(
    null,
    res.locals.user.id,
    "platform.payment",
    id(req.params.charge),
  );
  res.redirect(`/platform/${id(req.params.id)}`);
});
