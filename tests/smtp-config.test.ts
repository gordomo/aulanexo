import { test } from "node:test";
import assert from "node:assert/strict";
import { smtpOptions } from "../src/smtp-config.js";

test("development uses Mailpit without requiring TLS", () => {
  const result = smtpOptions({});
  assert.equal(result.host, "mailpit");
  assert.equal(result.port, 1025);
  assert.equal(result.secure, false);
  assert.equal(result.requireTLS, false);
  assert.equal(result.disableFileAccess, true);
});
test("production SMTP uses STARTTLS on 587 and literal credentials", () => {
  const password = "fake:$@#():!password";
  const result = smtpOptions({
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "user@example.com",
    SMTP_PASSWORD: password,
    MAIL_FROM: "AulaNexo <user@example.com>",
  });
  assert.equal(result.secure, false);
  assert.equal(result.requireTLS, true);
  assert.deepEqual(result.auth, { user: "user@example.com", pass: password });
});
test("SMTP URLs support encoded credentials and take precedence over separate fields", () => {
  const password = "fake:@#%/:!$password";
  const result = smtpOptions({
    MAILER_DSN: `smtp://${encodeURIComponent("user@example.com")}:${encodeURIComponent(password)}@smtp.example.com:587`,
    SMTP_HOST: "ignored.example.com",
    SMTP_USER: "ignored",
    SMTP_PASSWORD: "ignored",
  });
  assert.equal(result.host, "smtp.example.com");
  assert.deepEqual(result.auth, { user: "user@example.com", pass: password });
  assert.equal(result.port, 587);
});
test("SMTPS uses immediate TLS on 465", () => {
  const result = smtpOptions({
    MAILER_DSN: "smtps://user:fake-password@smtp.example.com:465",
  });
  assert.equal(result.secure, true);
  assert.equal(result.port, 465);
});
test("invalid SMTP configurations fail without exposing credentials", () => {
  assert.throws(
    () =>
      smtpOptions({ NODE_ENV: "production", MAIL_FROM: "user@example.com" }),
    /SMTP_HOST/,
  );
  assert.throws(
    () => smtpOptions({ SMTP_HOST: "smtp.example.com", SMTP_USER: "user" }),
    /juntos/,
  );
  assert.throws(
    () =>
      smtpOptions({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_SECURE: "true",
      }),
    /587/,
  );
  assert.throws(
    () => smtpOptions({ MAILER_DSN: "https://user:fake-secret@example.com" }),
    (error) => error instanceof Error && !error.message.includes("fake-secret"),
  );
  assert.throws(
    () =>
      smtpOptions({
        MAILER_DSN: "smtp://user:fake-secret@smtp.example.com?encryption=tls",
      }),
    /parámetros/,
  );
});
