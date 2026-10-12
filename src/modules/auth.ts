import { Router } from "express";
import { rows, write, transaction, audit } from "../db/index.js";
import {
  csrf,
  authenticated,
  signIn,
  digest,
  token,
  passwordHash,
  passwordMatches,
} from "../security.js";
import { email, text, option, InputError } from "../domain.js";
import { form, page, roleLabel } from "../ui.js";
import { queueMail, publicUrl } from "../mail.js";
export const auth = Router();
const attempts = new Map<string, { count: number; until: number }>();
auth.use((req, res, next) => {
  if (
    req.method !== "POST" ||
    !/^\/(login|forgot|register|invite|reset|request-institute)(\/|$)/.test(
      req.path,
    )
  )
    return next();
  const key = req.ip ?? "unknown";
  const now = Date.now();
  let state = attempts.get(key);
  if (!state || state.until < now) {
    state = { count: 0, until: now + 15 * 60000 };
    attempts.set(key, state);
  }
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  if (++state.count > 30) {
    res.status(429).render("error", {
      title: "Esperá unos minutos",
      message:
        "Se alcanzó el límite de intentos. Volvé a intentar en 15 minutos.",
    });
    return;
  }
  next();
});
auth.get("/login", (_req, res) =>
  form(
    res,
    "Iniciar sesión",
    [
      {
        name: "email",
        label: "Correo electrónico",
        type: "email",
        required: true,
      },
      {
        name: "password",
        label: "Contraseña",
        type: "password",
        required: true,
      },
    ],
    {
      button: "Ingresar",
      description:
        "Ingresá con tu cuenta y elegí el instituto donde querés trabajar.",
    },
  ),
);
auth.post("/login", csrf, async (req, res) => {
  const address = email(req.body.email);
  const user = (await rows("SELECT * FROM users WHERE email=?", [address]))[0];
  const valid =
    user && (await passwordMatches(req.body.password, user.password_hash));
  if (!valid || !user.active)
    throw new InputError("Correo o contraseña incorrectos.");
  await signIn(res, user.id);
  res.redirect(user.super_admin ? "/platform" : "/institutes");
});
auth.post("/logout", csrf, async (_req, res) => {
  await write("DELETE FROM sessions WHERE token_hash=?", [
    res.locals.session.token_hash,
  ]);
  res.clearCookie("an_session", { path: "/" });
  res.redirect("/login");
});
auth.get("/forgot", (_req, res) =>
  form(
    res,
    "Recuperar contraseña",
    [
      {
        name: "email",
        label: "Correo electrónico",
        type: "email",
        required: true,
      },
    ],
    { button: "Solicitar enlace" },
  ),
);
auth.post("/forgot", csrf, async (req, res) => {
  const address = email(req.body.email);
  const user = (
    await rows("SELECT id FROM users WHERE email=? AND active=1", [address])
  )[0];
  if (user) {
    const value = token();
    await transaction(async (db) => {
      await write(
        "UPDATE access_tokens SET used_at=UTC_TIMESTAMP() WHERE email=? AND kind='reset' AND used_at IS NULL",
        [address],
        db,
      );
      await write(
        "INSERT INTO access_tokens(token_hash,kind,email,expires_at) VALUES (?,'reset',?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))",
        [digest(value), address],
        db,
      );
      await queueMail(
        address,
        "Recuperá tu contraseña de AulaNexo",
        `Para cambiar tu contraseña abrí ${publicUrl()}/reset/${value}\nEl enlace vence en una hora. Si no lo solicitaste, ignorá este mensaje.`,
        db,
      );
    });
  }
  res.render("error", {
    title: "Solicitud recibida",
    message:
      "Si existe una cuenta habilitada con ese correo, recibirás instrucciones para recuperar la contraseña.",
  });
});
auth.get("/reset/:token", (_req, res) =>
  form(
    res,
    "Nueva contraseña",
    [
      {
        name: "password",
        label: "Contraseña nueva",
        type: "password",
        required: true,
        hint: "Entre 12 y 128 caracteres.",
      },
    ],
    { button: "Cambiar contraseña" },
  ),
);
auth.post("/reset/:token", csrf, async (req, res) => {
  const hash = await passwordHash(req.body.password);
  await transaction(async (db) => {
    const access = (
      await rows(
        "SELECT * FROM access_tokens WHERE token_hash=? AND kind='reset' AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE",
        [digest(String(req.params.token))],
        db,
      )
    )[0];
    if (!access)
      throw new InputError(
        "El enlace venció o ya fue utilizado. Solicitá uno nuevo.",
      );
    const user = (
      await rows(
        "SELECT id FROM users WHERE email=? AND active=1",
        [access.email],
        db,
      )
    )[0];
    if (!user) throw new InputError("Cuenta no disponible.");
    await write(
      "UPDATE users SET password_hash=? WHERE id=?",
      [hash, user.id],
      db,
    );
    await write("DELETE FROM sessions WHERE user_id=?", [user.id], db);
    await write(
      "UPDATE access_tokens SET used_at=UTC_TIMESTAMP() WHERE token_hash=?",
      [access.token_hash],
      db,
    );
  });
  res.redirect("/login");
});
auth.get("/register/:slug", async (req, res) => {
  const institute = (
    await rows("SELECT name FROM institutes WHERE slug=? AND active=1", [
      req.params.slug,
    ])
  )[0];
  if (!institute) {
    res.sendStatus(404);
    return;
  }
  form(
    res,
    `Solicitar acceso a ${institute.name}`,
    [
      { name: "name", label: "Nombre y apellido", required: true },
      {
        name: "email",
        label: "Correo electrónico",
        type: "email",
        required: true,
      },
      {
        name: "password",
        label: "Contraseña",
        type: "password",
        required: true,
        hint: "Si ya tenés cuenta en AulaNexo, usá tu contraseña actual. Para cuentas nuevas: mínimo 12 caracteres.",
      },
      {
        name: "role",
        label: "Solicitás acceso como",
        options: [
          { value: "student", label: "Alumno" },
          { value: "teacher", label: "Profesor" },
        ],
        required: true,
      },
    ],
    { button: "Enviar solicitud" },
  );
});
auth.post("/register/:slug", csrf, async (req, res) => {
  const address = email(req.body.email),
    name = text(req.body.name, "Nombre"),
    role = option(req.body.role, ["student", "teacher"]);
  const existing = (
    await rows("SELECT * FROM users WHERE email=?", [address])
  )[0];
  if (
    existing &&
    (!existing.active ||
      !(await passwordMatches(req.body.password, existing.password_hash)))
  )
    throw new InputError(
      "Para vincular una cuenta existente necesitás su contraseña.",
    );
  const hash = existing ? null : await passwordHash(req.body.password);
  await transaction(async (db) => {
    const institute = (
      await rows(
        "SELECT id FROM institutes WHERE slug=? AND active=1",
        [req.params.slug],
        db,
      )
    )[0];
    if (!institute) throw new InputError("Instituto no disponible.");
    let userId = existing?.id;
    if (!userId)
      userId = (
        await write(
          "INSERT INTO users(email,name,password_hash) VALUES (?,?,?)",
          [address, name, hash],
          db,
        )
      ).insertId;
    const current = (
      await rows(
        "SELECT status FROM memberships WHERE institute_id=? AND user_id=? FOR UPDATE",
        [institute.id, userId],
        db,
      )
    )[0];
    if (current && !["rejected", "inactive"].includes(current.status))
      throw new InputError(
        "Ya existe una solicitud o un acceso para esta cuenta.",
      );
    await write(
      "INSERT INTO memberships(institute_id,user_id,role,status) VALUES (?,?,?,'pending') ON DUPLICATE KEY UPDATE role=VALUES(role),status='pending'",
      [institute.id, userId, role],
      db,
    );
    await queueMail(
      address,
      "Solicitud de acceso recibida",
      `Tu solicitud para ${institute.id} está pendiente de aprobación.`,
      db,
    );
  });
  res.render("error", {
    title: "Solicitud enviada",
    message:
      "El administrador del instituto revisará tu solicitud. Recibirás un correo con su decisión.",
  });
});
auth.get("/invite/:token", async (req, res) => {
  const access = (
    await rows(
      "SELECT a.*,i.name AS institute_name FROM access_tokens a JOIN institutes i ON i.id=a.institute_id WHERE token_hash=? AND kind='invite' AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() AND i.active=1",
      [digest(String(req.params.token))],
    )
  )[0];
  if (!access) throw new InputError("La invitación venció o ya fue utilizada.");
  form(
    res,
    `Invitación a ${access.institute_name}`,
    [
      { name: "name", label: "Nombre y apellido", required: true },
      {
        name: "password",
        label: "Contraseña",
        type: "password",
        required: true,
        hint: "Usá tu contraseña actual si ya tenés cuenta. Para cuentas nuevas: mínimo 12 caracteres.",
      },
    ],
    {
      button: "Aceptar invitación",
      description: `Acceso como ${roleLabel(access.role)} para ${access.email}.`,
    },
  );
});
auth.post("/invite/:token", csrf, async (req, res) => {
  const name = text(req.body.name, "Nombre");
  let userId = 0;
  await transaction(async (db) => {
    const access = (
      await rows(
        "SELECT a.* FROM access_tokens a JOIN institutes i ON i.id=a.institute_id WHERE token_hash=? AND kind='invite' AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() AND i.active=1 FOR UPDATE",
        [digest(String(req.params.token))],
        db,
      )
    )[0];
    if (!access) throw new InputError("Invitación no disponible.");
    const existing = (
      await rows("SELECT * FROM users WHERE email=?", [access.email], db)
    )[0];
    if (existing) {
      if (
        !existing.active ||
        !(await passwordMatches(req.body.password, existing.password_hash))
      )
        throw new InputError("Ingresá la contraseña actual de esta cuenta.");
      userId = existing.id;
    } else
      userId = (
        await write(
          "INSERT INTO users(email,name,password_hash) VALUES (?,?,?)",
          [access.email, name, await passwordHash(req.body.password)],
          db,
        )
      ).insertId;
    const membership = (
      await rows(
        "SELECT role,status FROM memberships WHERE institute_id=? AND user_id=?",
        [access.institute_id, userId],
        db,
      )
    )[0];
    if (!membership)
      await write(
        "INSERT INTO memberships(institute_id,user_id,role,status) VALUES (?,?,?,'approved')",
        [access.institute_id, userId, access.role],
        db,
      );
    else if (membership.status !== "approved")
      await write(
        "UPDATE memberships SET role=?,status='approved' WHERE institute_id=? AND user_id=?",
        [access.role, access.institute_id, userId],
        db,
      );
    await write(
      "UPDATE access_tokens SET used_at=UTC_TIMESTAMP() WHERE token_hash=?",
      [access.token_hash],
      db,
    );
    await audit(
      access.institute_id,
      userId,
      "invitation.accept",
      null,
      null,
      db,
    );
  });
  await signIn(res, userId);
  res.redirect("/institutes");
});
auth.get("/institutes", authenticated, async (_req, res) => {
  const items = await rows(
    "SELECT i.id,i.name,m.role,m.status,i.active FROM memberships m JOIN institutes i ON i.id=m.institute_id WHERE m.user_id=? ORDER BY i.name",
    [res.locals.user.id],
  );
  page(
    res,
    "Mis institutos",
    ["Instituto", "Rol", "Estado", "Acceso"],
    items.map((i) => [
      i.name,
      roleLabel(i.role),
      !i.active
        ? "Instituto deshabilitado"
        : i.status === "approved"
          ? "Habilitado"
          : i.status === "pending"
            ? "Pendiente"
            : i.status === "rejected"
              ? "Rechazado"
              : "Deshabilitado",
      i.status === "approved" && i.active
        ? [{ label: "Ingresar", href: `/i/${i.id}` }]
        : [],
    ]),
    {
      actions: res.locals.user.superAdmin
        ? [{ label: "Panel de plataforma", href: "/platform" }]
        : [],
      description:
        "Tu acceso y rol se administran de forma independiente en cada instituto.",
    },
  );
});
