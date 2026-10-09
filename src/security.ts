import {
  randomBytes,
  scrypt as callbackScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { RequestHandler } from "express";
import { rows, write } from "./db/index.js";
import { InputError } from "./domain.js";
const scrypt = promisify(callbackScrypt);
export const token = () => randomBytes(32).toString("hex");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function passwordHash(password: string) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw new InputError("La contraseña debe tener entre 12 y 128 caracteres.");
  const salt = token();
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password: string, stored: string) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, hex] = stored.split(":");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const target = Buffer.from(hex, "hex");
  return key.length === target.length && timingSafeEqual(key, target);
}
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
};
export const session: RequestHandler = async (req, res, next) => {
  try {
    const raw = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("an_session="))
      ?.slice(11);
    let found =
      raw && /^[a-f0-9]{64}$/.test(raw)
        ? (
            await rows(
              "SELECT s.*, u.email,u.name,u.super_admin,u.active FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()",
              [digest(raw)],
            )
          )[0]
        : undefined;
    if (!found) {
      const value = token();
      found = {
        token_hash: digest(value),
        user_id: null,
        csrf: token(),
      } as any;
      await write(
        "INSERT INTO sessions(token_hash,csrf,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))",
        [found!.token_hash, found!.csrf],
      );
      res.cookie("an_session", value, cookieOptions);
    }
    res.locals.session = found;
    res.locals.user = found!.active
      ? {
          id: found!.user_id,
          email: found!.email,
          name: found!.name,
          superAdmin: Boolean(found!.super_admin),
        }
      : null;
    res.locals.csrf = found!.csrf;
    next();
  } catch (e) {
    next(e);
  }
};
export async function signIn(res: any, userId: number) {
  await write("DELETE FROM sessions WHERE token_hash=?", [
    res.locals.session.token_hash,
  ]);
  const value = token();
  await write(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))",
    [digest(value), userId, token()],
  );
  res.cookie("an_session", value, cookieOptions);
}
export const csrf: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const supplied = req.body?._csrf;
  if (
    typeof supplied !== "string" ||
    supplied.length !== 64 ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(res.locals.csrf))
  ) {
    res
      .status(403)
      .render("error", {
        title: "Solicitud inválida",
        message:
          "La sesión del formulario cambió. Volvé a abrir la página e intentá nuevamente.",
      });
    return;
  }
  next();
};
export const authenticated: RequestHandler = (_req, res, next) => {
  if (!res.locals.user?.id) {
    res.redirect("/login");
    return;
  }
  next();
};
export const superAdmin: RequestHandler = (_req, res, next) => {
  if (!res.locals.user?.superAdmin) {
    res
      .status(403)
      .render("error", {
        title: "Acceso restringido",
        message: "Esta función es exclusiva del superadministrador.",
      });
    return;
  }
  next();
};
export const tenant: RequestHandler = async (req, res, next) => {
  try {
    const tenantId = Number(req.params.tenant);
    if (!Number.isSafeInteger(tenantId) || tenantId < 1) {
      res.sendStatus(404);
      return;
    }
    const membership = (
      await rows(
        "SELECT m.*,i.name AS institute_name,i.settings,i.active FROM memberships m JOIN institutes i ON i.id=m.institute_id WHERE m.institute_id=? AND m.user_id=? AND m.status='approved' AND i.active=1",
        [tenantId, res.locals.user.id],
      )
    )[0];
    if (!membership) {
      res
        .status(403)
        .render("error", {
          title: "Acceso restringido",
          message: "No tenés acceso habilitado a este instituto.",
        });
      return;
    }
    res.locals.membership = membership;
    res.locals.tenantId = tenantId;
    res.locals.base = `/i/${tenantId}`;
    res.locals.settings =
      typeof membership.settings === "string"
        ? JSON.parse(membership.settings)
        : membership.settings;
    next();
  } catch (e) {
    next(e);
  }
};
export const admin: RequestHandler = (_req, res, next) => {
  if (res.locals.membership?.role !== "admin") {
    res
      .status(403)
      .render("error", {
        title: "Acceso restringido",
        message: "Esta función requiere el rol administrador del instituto.",
      });
    return;
  }
  next();
};
