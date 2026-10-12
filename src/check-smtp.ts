import nodemailer from "nodemailer";
import { smtpOptions } from "./smtp-config.js";
let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
try {
  transport = nodemailer.createTransport(smtpOptions());
  await transport.verify();
  console.log("Conexión y autenticación SMTP verificadas.");
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "CONFIGURATION";
  const safeCode = /^[A-Z_]{2,30}$/.test(code) ? code : "SMTP_ERROR";
  console.error(
    `No se pudo verificar SMTP (${safeCode}). Revisá servidor, puerto, TLS y credenciales.`,
  );
  process.exitCode = 1;
} finally {
  transport?.close();
}
