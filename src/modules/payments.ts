import { Router } from "express";
import { rows, write, transaction, audit } from "../db/index.js";
import { admin, csrf } from "../security.js";
import {
  id,
  date,
  text,
  cents,
  option,
  InputError,
  money,
  today,
} from "../domain.js";
import { form, page } from "../ui.js";
import { queueMail } from "../mail.js";
export const payments = Router({ mergeParams: true });
payments.use((_req, res, next) => {
  if (res.locals.membership.role === "teacher") {
    res.sendStatus(403);
    return;
  }
  next();
});
payments.get("/", async (req, res) => {
  const t = res.locals.tenantId,
    student = res.locals.membership.role === "student";
  let sql =
    "SELECT c.*,p.first_name,p.last_name,pay.id AS payment_id FROM charges c JOIN people p ON p.institute_id=c.institute_id AND p.id=c.person_id LEFT JOIN payments pay ON pay.institute_id=c.institute_id AND pay.charge_id=c.id WHERE c.institute_id=?";
  const values: any[] = [t];
  if (student) {
    sql += " AND p.user_id=? AND p.active=1";
    values.push(res.locals.user.id);
  }
  if (req.query.status) {
    sql += " AND c.status=?";
    values.push(option(req.query.status, ["pending", "paid", "forgiven"]));
  }
  const data = await rows(sql + " ORDER BY c.due_date DESC,c.id DESC", values);
  page(
    res,
    student ? "Mis pagos" : "Cuotas y pagos",
    ["Alumno", "Concepto", "Importe", "Vencimiento", "Estado", "Acciones"],
    data.map((c) => [
      `${c.last_name}, ${c.first_name}`,
      c.description,
      money(c.cents),
      c.due_date,
      c.status === "paid"
        ? "Pagado"
        : c.status === "forgiven"
          ? `Condonado: ${c.forgiveness_reason}`
          : "Pendiente",
      c.payment_id
        ? [
            {
              label: "Recibo",
              href: `${res.locals.base}/payments/receipts/${c.payment_id}`,
            },
          ]
        : !student && c.status === "pending"
          ? [
              {
                label: "Cobrar",
                href: `${res.locals.base}/payments/${c.id}/pay`,
              },
              {
                label: "Condonar",
                href: `${res.locals.base}/payments/${c.id}/forgive`,
              },
              {
                label: "Recordar deuda",
                action: `${res.locals.base}/payments/${c.id}/remind`,
                confirm: "¿Querés enviar un recordatorio de esta deuda?",
              },
            ]
          : [],
    ]),
    {
      description: `Saldo pendiente: ${money(data.filter((c) => c.status === "pending").reduce((sum, c) => sum + Number(c.cents), 0))}. Los pagos se registran por el importe completo.`,
      actions: [
        { label: "Todos", href: res.locals.base + "/payments" },
        {
          label: "Pendientes",
          href: res.locals.base + "/payments?status=pending",
        },
        ...(!student
          ? [
              {
                label: "Agregar cargo manual",
                href: res.locals.base + "/payments/new",
              },
            ]
          : []),
      ],
    },
  );
});
payments.get("/new", admin, async (_req, res) => {
  const people = await rows(
    "SELECT id,first_name,last_name FROM people WHERE institute_id=? AND kind='student' AND active=1 ORDER BY last_name",
    [res.locals.tenantId],
  );
  form(res, "Agregar cargo manual", [
    {
      name: "person_id",
      label: "Alumno",
      options: people.map((p) => ({
        value: p.id,
        label: `${p.last_name}, ${p.first_name}`,
      })),
      required: true,
    },
    { name: "description", label: "Concepto", required: true },
    {
      name: "amount",
      label: "Importe (ARS)",
      type: "number",
      step: "0.01",
      min: "0.01",
      required: true,
    },
    { name: "due_date", label: "Vencimiento", type: "date", required: true },
  ]);
});
payments.post("/new", admin, csrf, async (req, res) => {
  const t = res.locals.tenantId,
    pid = id(req.body.person_id),
    amount = cents(req.body.amount);
  if (!amount) throw new InputError("El importe debe ser mayor a cero.");
  if (
    !(
      await rows(
        "SELECT id FROM people WHERE institute_id=? AND id=? AND kind='student' AND active=1",
        [t, pid],
      )
    ).length
  )
    throw new InputError("Alumno no disponible.");
  const charge = (
    await write(
      "INSERT INTO charges(institute_id,person_id,kind,description,cents,due_date) VALUES (?,?,'manual',?,?,?)",
      [
        t,
        pid,
        text(req.body.description, "Concepto", 255),
        amount,
        date(req.body.due_date),
      ],
    )
  ).insertId;
  await audit(t, res.locals.user.id, "charge.create", charge);
  res.redirect(res.locals.base + "/payments");
});
payments.get("/:id/pay", admin, async (req, res) => {
  const c = (
    await rows(
      "SELECT * FROM charges WHERE institute_id=? AND id=? AND status='pending'",
      [res.locals.tenantId, id(req.params.id)],
    )
  )[0];
  if (!c) throw new InputError("Cargo no disponible para cobrar.");
  form(
    res,
    `Registrar cobro: ${money(c.cents)}`,
    [
      {
        name: "paid_date",
        label: "Fecha de pago",
        type: "date",
        value: today(),
        required: true,
      },
      {
        name: "method",
        label: "Método de pago",
        options: res.locals.settings.paymentMethods.map((s: string) => ({
          value: s,
          label: s,
        })),
        required: true,
      },
      { name: "reference", label: "Referencia u observación" },
    ],
    { description: c.description, button: "Confirmar pago completo" },
  );
});
payments.post("/:id/pay", admin, csrf, async (req, res) => {
  const t = res.locals.tenantId,
    cid = id(req.params.id),
    paid = date(req.body.paid_date),
    method = option(req.body.method, res.locals.settings.paymentMethods),
    reference = text(req.body.reference, "Referencia", 160, false);
  let paymentId = 0;
  await transaction(async (db) => {
    const c = (
      await rows(
        "SELECT c.*,p.email,p.first_name,p.last_name FROM charges c JOIN people p ON p.institute_id=c.institute_id AND p.id=c.person_id WHERE c.institute_id=? AND c.id=? FOR UPDATE",
        [t, cid],
        db,
      )
    )[0];
    if (!c || c.status !== "pending")
      throw new InputError(
        "El cargo ya fue pagado, condonado o no está disponible.",
      );
    paymentId = (
      await write(
        "INSERT INTO payments(institute_id,charge_id,method,paid_date,reference,received_by) VALUES (?,?,?,?,?,?)",
        [t, cid, method, paid, reference, res.locals.user.id],
        db,
      )
    ).insertId;
    await write(
      "UPDATE charges SET status='paid' WHERE institute_id=? AND id=?",
      [t, cid],
      db,
    );
    if (c.email)
      await queueMail(
        c.email,
        `Recibo ${paymentId} · ${res.locals.membership.institute_name}`,
        `Recibo interno #${paymentId}\nAlumno: ${c.first_name} ${c.last_name}\nConcepto: ${c.description}\nImporte: ${money(c.cents)}\nFecha: ${paid}\nMétodo: ${method}\nNo constituye factura fiscal. Podés consultar e imprimir el recibo desde AulaNexo.`,
        db,
      );
    await audit(t, res.locals.user.id, "payment.create", paymentId, null, db);
  });
  res.redirect(`${res.locals.base}/payments/receipts/${paymentId}`);
});
payments.get("/:id/forgive", admin, async (req, res) => {
  const c = (
    await rows(
      "SELECT * FROM charges WHERE institute_id=? AND id=? AND status='pending'",
      [res.locals.tenantId, id(req.params.id)],
    )
  )[0];
  if (!c) throw new InputError("Cargo no disponible.");
  form(
    res,
    `Condonar deuda: ${money(c.cents)}`,
    [
      {
        name: "reason",
        label: "Motivo de la condonación",
        type: "textarea",
        required: true,
      },
    ],
    {
      description: `${c.description}. La deuda se perdona sin registrar un pago. El motivo y el responsable quedan en el historial.`,
      button: "Confirmar condonación",
      confirm: "¿Confirmás perdonar esta deuda? No se registrará como un pago.",
    },
  );
});
payments.post("/:id/forgive", admin, csrf, async (req, res) => {
  const reason = text(req.body.reason, "Motivo", 3000),
    t = res.locals.tenantId,
    cid = id(req.params.id);
  await transaction(async (db) => {
    const c = (
      await rows(
        "SELECT status FROM charges WHERE institute_id=? AND id=? FOR UPDATE",
        [t, cid],
        db,
      )
    )[0];
    if (!c || c.status !== "pending")
      throw new InputError("La deuda no está pendiente.");
    await write(
      "UPDATE charges SET status='forgiven',forgiveness_reason=? WHERE institute_id=? AND id=?",
      [reason, t, cid],
      db,
    );
    await audit(t, res.locals.user.id, "charge.forgive", cid, reason, db);
  });
  res.redirect(res.locals.base + "/payments");
});
payments.get("/receipts/:id", async (req, res) => {
  const t = res.locals.tenantId,
    student = res.locals.membership.role === "student";
  const data = await rows(
    "SELECT pay.*,c.description,c.cents,p.first_name,p.last_name,p.dni FROM payments pay JOIN charges c ON c.institute_id=pay.institute_id AND c.id=pay.charge_id JOIN people p ON p.institute_id=c.institute_id AND p.id=c.person_id WHERE pay.institute_id=? AND pay.id=?" +
      (student ? " AND p.user_id=?" : ""),
    student
      ? [t, id(req.params.id), res.locals.user.id]
      : [t, id(req.params.id)],
  );
  const p = data[0];
  if (!p) {
    res.sendStatus(404);
    return;
  }
  res.render("receipt", { title: `Recibo #${p.id}`, receipt: p });
});

payments.post("/:id/remind", admin, csrf, async (req, res) => {
  const t = res.locals.tenantId,
    cid = id(req.params.id);
  await transaction(async (db) => {
    const c = (
      await rows(
        "SELECT c.*,p.email,p.user_id FROM charges c JOIN people p ON p.institute_id=c.institute_id AND p.id=c.person_id WHERE c.institute_id=? AND c.id=? AND c.status='pending'",
        [t, cid],
        db,
      )
    )[0];
    if (!c) throw new InputError("Deuda no disponible.");
    if (!c.email && !c.user_id)
      throw new InputError(
        "El alumno no tiene correo ni cuenta vinculada. Completá sus datos primero.",
      );
    const body = `Tenés pendiente ${c.description}: ${money(c.cents)}, con vencimiento ${c.due_date}. Contactá al instituto para coordinar el pago.`;
    if (c.email)
      await queueMail(
        c.email,
        `Recordatorio de deuda · ${res.locals.membership.institute_name}`,
        body,
        db,
      );
    if (
      c.user_id &&
      (
        await rows(
          "SELECT id FROM memberships WHERE institute_id=? AND user_id=? AND status='approved'",
          [t, c.user_id],
          db,
        )
      ).length
    ) {
      const n = (
        await write(
          "INSERT INTO notifications(institute_id,title,body) VALUES (?,'Recordatorio de deuda',?)",
          [t, body],
          db,
        )
      ).insertId;
      await write(
        "INSERT INTO notification_recipients(institute_id,notification_id,user_id) VALUES (?,?,?)",
        [t, n, c.user_id],
        db,
      );
    }
    await audit(t, res.locals.user.id, "charge.remind", cid, null, db);
  });
  res.redirect(res.locals.base + "/payments");
});
