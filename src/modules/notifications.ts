import { Router } from "express";
import { rows, write, transaction, audit } from "../db/index.js";
import { admin, csrf } from "../security.js";
import { id, text, option, InputError } from "../domain.js";
import { form, page } from "../ui.js";
import { queueMail } from "../mail.js";
export const notifications = Router({ mergeParams: true });
notifications.get("/", async (_req, res) => {
  const data = await rows(
    "SELECT n.*,r.read_at FROM notification_recipients r JOIN notifications n ON n.institute_id=r.institute_id AND n.id=r.notification_id WHERE r.institute_id=? AND r.user_id=? ORDER BY n.created_at DESC",
    [res.locals.tenantId, res.locals.user.id],
  );
  page(
    res,
    "Notificaciones",
    ["Fecha", "Título", "Estado", "Acción"],
    data.map((n) => [
      n.created_at,
      n.title,
      n.read_at ? "Leída" : "Sin leer",
      [
        {
          label: "Consultar",
          href: `${res.locals.base}/notifications/${n.id}`,
        },
      ],
    ]),
    {
      actions:
        res.locals.membership.role === "admin"
          ? [
              {
                label: "Crear notificación",
                href: res.locals.base + "/notifications/new",
              },
            ]
          : [],
    },
  );
});
notifications.get("/new", admin, async (_req, res) => {
  const users = await rows(
    "SELECT m.user_id,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.institute_id=? AND m.status='approved' ORDER BY u.name",
    [res.locals.tenantId],
  );
  const commissions = await rows(
    "SELECT id,name FROM commissions WHERE institute_id=?",
    [res.locals.tenantId],
  );
  form(
    res,
    "Crear notificación",
    [
      { name: "title", label: "Título", required: true },
      { name: "body", label: "Mensaje", type: "textarea", required: true },
      {
        name: "audience",
        label: "Destinatarios",
        options: [
          { value: "all", label: "Todos los usuarios habilitados" },
          { value: "admin", label: "Administradores" },
          { value: "teacher", label: "Profesores" },
          { value: "student", label: "Alumnos" },
          { value: "user", label: "Un usuario" },
          { value: "commission", label: "Una comisión" },
        ],
        required: true,
      },
      {
        name: "user_id",
        label: "Usuario (solo si elegís un usuario)",
        options: [
          { value: "", label: "Sin seleccionar" },
          ...users.map((u) => ({
            value: u.user_id,
            label: `${u.name} (${u.email})`,
          })),
        ],
      },
      {
        name: "commission_id",
        label: "Comisión (solo si elegís una comisión)",
        options: [
          { value: "", label: "Sin seleccionar" },
          ...commissions.map((c) => ({ value: c.id, label: c.name })),
        ],
      },
      {
        name: "send_email",
        label: "También enviar por correo",
        options: [
          { value: "yes", label: "Sí" },
          { value: "no", label: "No" },
        ],
        required: true,
      },
    ],
    {
      description:
        "El mensaje solo estará disponible para los destinatarios habilitados en este instituto.",
    },
  );
});
notifications.post("/new", admin, csrf, async (req, res) => {
  const t = res.locals.tenantId,
    title = text(req.body.title, "Título"),
    body = text(req.body.body, "Mensaje", 5000),
    audience = option(req.body.audience, [
      "all",
      "admin",
      "teacher",
      "student",
      "user",
      "commission",
    ]),
    send = option(req.body.send_email, ["yes", "no"]) === "yes";
  await transaction(async (db) => {
    let sql =
      "SELECT u.id,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.institute_id=? AND m.status='approved' AND u.active=1";
    const values: any[] = [t];
    if (["admin", "teacher", "student"].includes(audience)) {
      sql += " AND m.role=?";
      values.push(audience);
    }
    if (audience === "user") {
      sql += " AND u.id=?";
      values.push(id(req.body.user_id));
    }
    if (audience === "commission") {
      const cid = id(req.body.commission_id);
      if (
        !(
          await rows(
            "SELECT id FROM commissions WHERE institute_id=? AND id=?",
            [t, cid],
            db,
          )
        ).length
      )
        throw new InputError("Comisión no disponible.");
      sql +=
        " AND EXISTS(SELECT 1 FROM people p WHERE p.institute_id=m.institute_id AND p.user_id=u.id AND p.active=1 AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.institute_id=p.institute_id AND e.person_id=p.id AND e.commission_id=?) OR EXISTS(SELECT 1 FROM teaching a WHERE a.institute_id=p.institute_id AND a.person_id=p.id AND a.commission_id=?)))";
      values.push(cid, cid);
    }
    const targets = await rows(sql, values, db);
    if (!targets.length)
      throw new InputError(
        "No hay destinatarios habilitados para esta selección.",
      );
    const n = (
      await write(
        "INSERT INTO notifications(institute_id,title,body) VALUES (?,?,?)",
        [t, title, body],
        db,
      )
    ).insertId;
    for (const u of targets) {
      await write(
        "INSERT INTO notification_recipients(institute_id,notification_id,user_id) VALUES (?,?,?)",
        [t, n, u.id],
        db,
      );
      if (send)
        await queueMail(
          u.email,
          `${res.locals.membership.institute_name}: ${title}`,
          body,
          db,
        );
    }
    await audit(t, res.locals.user.id, "notification.create", n, null, db);
  });
  res.redirect(res.locals.base + "/notifications");
});
notifications.get("/:id", async (req, res) => {
  const n = (
    await rows(
      "SELECT n.* FROM notifications n JOIN notification_recipients r ON r.institute_id=n.institute_id AND r.notification_id=n.id WHERE r.institute_id=? AND r.notification_id=? AND r.user_id=?",
      [res.locals.tenantId, id(req.params.id), res.locals.user.id],
    )
  )[0];
  if (!n) {
    res.sendStatus(404);
    return;
  }
  page(res, n.title, ["Fecha", "Mensaje"], [[n.created_at, n.body]], {
    actions: [
      {
        label: "Marcar como leída",
        action: `${res.locals.base}/notifications/${n.id}/read`,
      },
    ],
  });
});
notifications.post("/:id/read", csrf, async (req, res) => {
  await write(
    "UPDATE notification_recipients SET read_at=UTC_TIMESTAMP() WHERE institute_id=? AND notification_id=? AND user_id=?",
    [res.locals.tenantId, id(req.params.id), res.locals.user.id],
  );
  res.redirect(res.locals.base + "/notifications");
});
