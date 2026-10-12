import express from "express";
import helmet from "helmet";
import path from "node:path";
import { session, csrf } from "./security.js";
import { auth } from "./modules/auth.js";
import { platform } from "./modules/platform.js";
import { institute } from "./modules/institute.js";
import { instituteRequests } from "./modules/institute-requests.js";
import { attendance } from "./modules/attendance.js";
import { payments } from "./modules/payments.js";
import { notifications } from "./modules/notifications.js";
import { InputError, money } from "./domain.js";
import { roleLabel } from "./ui.js";
import { help } from "./help.js";
institute.use("/attendance", attendance);
institute.use("/payments", payments);
institute.use("/notifications", notifications);
institute.get("/help", (_req, res) => help(res));
export function createApp(checkDatabase: () => Promise<void>, features = true) {
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(helmet());
  app.set("view engine", "ejs");
  app.set("views", path.resolve("src/views"));
  app.use("/assets", express.static(path.resolve("src/public")));
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use(
    express.urlencoded({
      extended: false,
      limit: "64kb",
      parameterLimit: 2000,
    }),
  );
  app.use((_req, res, next) => {
    Object.assign(res.locals, {
      title: "AulaNexo",
      user: null,
      csrf: "",
      base: null,
      membership: null,
      money,
      roleLabel,
    });
    res.set("Cache-Control", "no-store");
    next();
  });
  if (features) {
    app.use(session);
    app.use(auth);
    app.use("/request-institute", instituteRequests);
    app.use("/platform", platform);
    app.use("/i/:tenant", institute);
    app.use(csrf);
  }
  app.get("/", (_req, res) => res.render("home"));
  app.use((_req, res) =>
    res.status(404).render("error", {
      title: "Página no encontrada",
      message: "La dirección no existe o el registro no está disponible.",
    }),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      let message = "No pudimos completar la operación. Intentá nuevamente.",
        status = 500;
      if (error instanceof InputError) {
        status = 400;
        message = error.message;
      } else if (error?.code === "ER_DUP_ENTRY") {
        status = 409;
        message =
          "Ese registro ya existe. Revisá los datos para evitar duplicados.";
      } else if (error?.code === "ER_NO_REFERENCED_ROW_2") {
        status = 400;
        message =
          "Los registros seleccionados no pertenecen a este instituto o ya no están disponibles.";
      } else if (error?.type === "entity.too.large") {
        status = 413;
        message = "El formulario supera el tamaño permitido.";
      } else
        console.error(
          "Error de aplicación",
          error?.code ?? error?.name ?? "unknown",
        );
      res
        .status(status)
        .render("error", { title: "Revisá la operación", message });
    },
  );
  return app;
}
