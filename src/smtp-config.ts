import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

type Environment = Record<string, string | undefined>;
function boolean(
  value: string | undefined,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} debe ser true o false.`);
}

export function smtpOptions(
  env: Environment = process.env,
): SMTPTransport.Options {
  const production = env.NODE_ENV === "production";
  let host = env.SMTP_HOST,
    port = Number(env.SMTP_PORT || 587),
    user = env.SMTP_USER,
    password = env.SMTP_PASSWORD,
    secure: boolean;
  if (env.MAILER_DSN) {
    let url: URL;
    try {
      url = new URL(env.MAILER_DSN);
    } catch {
      throw new Error(
        "MAILER_DSN inválido. Usá smtp:// o smtps:// con credenciales codificadas.",
      );
    }
    if (
      !["smtp:", "smtps:"].includes(url.protocol) ||
      !url.hostname ||
      url.hash ||
      (url.pathname && url.pathname !== "/")
    )
      throw new Error("MAILER_DSN debe contener un servidor SMTP válido.");
    if (url.search)
      throw new Error(
        "Usá SMTP_REQUIRE_TLS para configurar TLS; MAILER_DSN no admite parámetros de Symfony.",
      );
    host = url.hostname;
    port = Number(url.port || (url.protocol === "smtps:" ? 465 : 587));
    secure = url.protocol === "smtps:";
    try {
      user = decodeURIComponent(url.username);
      password = decodeURIComponent(url.password);
    } catch {
      throw new Error(
        "Las credenciales de MAILER_DSN tienen una codificación inválida.",
      );
    }
  } else {
    if (!host) {
      if (production)
        throw new Error("Configurá SMTP_HOST o MAILER_DSN para producción.");
      host = "mailpit";
      port = Number(env.SMTP_PORT || 1025);
    }
    secure = boolean(env.SMTP_SECURE, port === 465, "SMTP_SECURE");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP_PORT debe ser un puerto válido.");
  if (port === 587 && secure)
    throw new Error("En el puerto 587 usá SMTP_SECURE=false y STARTTLS.");
  if (port === 465 && !secure)
    throw new Error("En el puerto 465 usá SMTP_SECURE=true o smtps://.");
  if (Boolean(user) !== Boolean(password))
    throw new Error("Configurá juntos SMTP_USER y SMTP_PASSWORD.");
  if (production && !env.MAIL_FROM?.trim())
    throw new Error("Configurá MAIL_FROM con el remitente real.");
  return {
    host,
    port,
    secure,
    requireTLS: boolean(
      env.SMTP_REQUIRE_TLS,
      production && !secure,
      "SMTP_REQUIRE_TLS",
    ),
    ...(user ? { auth: { user, pass: password! } } : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
