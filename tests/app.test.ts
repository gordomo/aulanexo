import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

test("readiness fails safely when database is unavailable", async () => {
  const app = createApp(async () => {
    throw new Error("secret connection details");
  }, false);
  const result = await request(app).get("/health/ready");
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { status: "unavailable" });
  assert.ok(!result.text.includes("secret"));
  assert.equal((await request(app).get("/health/live")).status, 200);
});
test("readiness verifies the database", async () => {
  let checked = false;
  const result = await request(
    createApp(async () => {
      checked = true;
    }, false),
  ).get("/health/ready");
  assert.equal(result.status, 200);
  assert.equal(checked, true);
});
test("landing page is accessible and unknown routes return 404", async () => {
  const app = createApp(async () => {}, false);
  const result = await request(app).get("/");
  assert.equal(result.status, 200);
  assert.match(result.text, /lang="es"/);
  assert.match(result.text, /name="viewport"/);
  assert.ok(result.headers["content-security-policy"]);
  assert.equal((await request(app).get("/unknown")).status, 404);
});
