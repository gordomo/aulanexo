import { Router } from "express";
import { rows, write, transaction, audit } from "../db/index.js";
import { csrf, digest } from "../security.js";
import { text, email, id, InputError } from "../domain.js";
import { form, page } from "../ui.js";
import { queueMail, publicUrl } from "../mail.js";

export const instituteRequests = Router();
export const requestReview = Router();
const statusLabel = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
};

instituteRequests.get("/", (_req, res) =>
  form(
    res,
    "Solicitar acceso para mi instituto",
    [
      { name: "institute_name", label: "Nombre del instituto", required: true },
      { name: "contact_name", label: "Tu nombre y apellido", required: true },
      {
        name: "email",
        label: "Correo de contacto",
        type: "email",
        required: true,
      },
      { name: "phone", label: "Teléfono de contacto" },
      {
        name: "message",
        label: "Contanos qué necesita tu instituto",
        type: "textarea",
      },
    ],
    {
      button: "Enviar solicitud",
      description:
        "Revisaremos tu solicitud y te responderemos por correo. Si se aprueba, recibirás una invitación para administrar tu instituto y conocerás el importe y el vencimiento del abono. No necesitás crear una cuenta para solicitar el servicio.",
      backHref: "/",
    },
  ),
);

instituteRequests.post("/", csrf, async (req, res) => {
  const instituteName = text(req.body.institute_name, "Instituto"),
    contactName = text(req.body.contact_name, "Nombre"),
    address = email(req.body.email),
    phone = text(req.body.phone, "Teléfono", 40, false),
    message = text(req.body.message, "Mensaje", 3000, false),
    requestKey = digest(`${address}|${instituteName.toLowerCase()}`);
  await transaction(async (db) => {
    if (
      (
        await rows(
          "SELECT id FROM institute_requests WHERE pending_key=?",
          [requestKey],
          db,
        )
      ).length
    )
      throw new InputError(
        "Ya hay una solicitud pendiente para este instituto y correo. Te responderemos cuando sea revisada.",
      );
    const requestId = (
      await write(
        "INSERT INTO institute_requests(institute_name,contact_name,email,phone,message,request_key) VALUES (?,?,?,?,?,?)",
        [
          instituteName,
          contactName,
          address,
          phone || null,
          message || null,
          requestKey,
        ],
        db,
      )
    ).insertId;
    await queueMail(
      address,
      "Recibimos tu solicitud para AulaNexo",
      `Hola ${contactName}. Recibimos tu solicitud para ${instituteName}. Está pendiente de revisión. Te enviaremos la decisión y, si se aprueba, una invitación para acceder. Esta solicitud no crea un instituto habilitado ni una cuenta de usuario.`,
      db,
    );
    const owners = await rows(
      "SELECT email FROM users WHERE super_admin=1 AND active=1",
      [],
      db,
    );
    for (const owner of owners)
      await queueMail(
        owner.email,
        "Nueva solicitud de instituto en AulaNexo",
        `${instituteName} solicitó acceso. Responsable: ${contactName}. Revisá la solicitud #${requestId} en ${publicUrl()}/platform/requests/${requestId}`,
        db,
      );
  });
  res.render("notice", {
    title: "Solicitud enviada",
    message:
      "Recibimos tu solicitud. Revisaremos los datos y te responderemos al correo indicado. Si se aprueba, recibirás una invitación para configurar tu cuenta y administrar el instituto.",
    href: "/",
    label: "Volver al inicio",
  });
});

requestReview.get("/", async (_req, res) => {
  const data = await rows(
    "SELECT * FROM institute_requests ORDER BY status='pending' DESC,created_at DESC",
  );
  page(
    res,
    "Solicitudes de institutos",
    ["Instituto", "Responsable", "Correo", "Fecha", "Estado", "Acciones"],
    data.map((r) => [
      r.institute_name,
      r.contact_name,
      r.email,
      r.created_at,
      statusLabel[r.status as keyof typeof statusLabel],
      [{ label: "Revisar", href: `/platform/requests/${r.id}` }],
    ]),
    {
      description:
        "Las solicitudes no habilitan institutos ni usuarios. Revisalas y definí el abono antes de enviar la invitación.",
      actions: [{ label: "Institutos", href: "/platform" }],
    },
  );
});

requestReview.get("/:request", async (req, res) => {
  const r = (
    await rows("SELECT * FROM institute_requests WHERE id=?", [
      id(req.params.request),
    ])
  )[0];
  if (!r) {
    res.sendStatus(404);
    return;
  }
  page(
    res,
    `Solicitud de ${r.institute_name}`,
    ["Dato", "Información"],
    [
      ["Responsable", r.contact_name],
      ["Correo", r.email],
      ["Teléfono", r.phone || "Sin completar"],
      ["Mensaje", r.message || "Sin mensaje"],
      ["Estado", statusLabel[r.status as keyof typeof statusLabel]],
      ["Fecha", r.created_at],
      ...(r.review_reason ? [["Motivo", r.review_reason]] : []),
    ],
    {
      actions:
        r.status === "pending"
          ? [
              {
                label: "Crear instituto y aprobar",
                href: `/platform/new?request=${r.id}`,
              },
              {
                label: "Rechazar solicitud",
                href: `/platform/requests/${r.id}/reject`,
              },
            ]
          : r.institute_id
            ? [{ label: "Ver instituto", href: `/platform/${r.institute_id}` }]
            : [],
    },
  );
});

requestReview.get("/:request/reject", async (req, res) => {
  const r = (
    await rows(
      "SELECT institute_name FROM institute_requests WHERE id=? AND status='pending'",
      [id(req.params.request)],
    )
  )[0];
  if (!r)
    throw new InputError("La solicitud ya fue resuelta o no está disponible.");
  form(
    res,
    `Rechazar solicitud de ${r.institute_name}`,
    [
      {
        name: "reason",
        label: "Motivo del rechazo",
        type: "textarea",
        required: true,
      },
    ],
    {
      button: "Confirmar rechazo",
      description: "El responsable recibirá el motivo por correo.",
      confirm:
        "¿Confirmás rechazar esta solicitud y enviar el motivo por correo?",
      backHref: "/platform/requests",
    },
  );
});

requestReview.post("/:request/reject", csrf, async (req, res) => {
  const requestId = id(req.params.request),
    reason = text(req.body.reason, "Motivo", 3000);
  await transaction(async (db) => {
    const r = (
      await rows(
        "SELECT * FROM institute_requests WHERE id=? AND status='pending' FOR UPDATE",
        [requestId],
        db,
      )
    )[0];
    if (!r)
      throw new InputError(
        "La solicitud ya fue resuelta o no está disponible.",
      );
    await write(
      "UPDATE institute_requests SET status='rejected',reviewed_by=?,review_reason=?,reviewed_at=UTC_TIMESTAMP() WHERE id=?",
      [res.locals.user.id, reason, requestId],
      db,
    );
    await queueMail(
      r.email,
      "Respuesta a tu solicitud de AulaNexo",
      `Hola ${r.contact_name}. No aprobamos la solicitud para ${r.institute_name}. Motivo: ${reason}`,
      db,
    );
    await audit(
      null,
      res.locals.user.id,
      "institute_request.reject",
      requestId,
      reason,
      db,
    );
  });
  res.redirect(`/platform/requests/${requestId}`);
});
