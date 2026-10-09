import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  date,
  nextBillingMonth,
  discounted,
  dueDate,
  InputError,
} from "../src/domain.js";
import { passwordHash, passwordMatches } from "../src/security.js";
test("money uses integer cents and rejects hidden rounding", () => {
  assert.equal(cents("123,45"), 12345);
  assert.equal(cents("0.01"), 1);
  assert.throws(() => cents("1.234"), InputError);
  assert.throws(() => cents("-1"), InputError);
  assert.throws(() => cents("1e4"), InputError);
  assert.equal(discounted(101, 50), 51);
});
test("mid-month entry starts billing next month, including year rollover", () => {
  assert.equal(nextBillingMonth("2026-10-15"), "2026-11-01");
  assert.equal(nextBillingMonth("2026-12-31"), "2027-01-01");
  assert.equal(dueDate("2027-02", 28), "2027-02-28");
  assert.throws(() => date("2026-02-30"), InputError);
});
test("password hashing uses unique salts and verifies securely", async () => {
  const a = await passwordHash("A-valid-password-123");
  const b = await passwordHash("A-valid-password-123");
  assert.notEqual(a, b);
  assert.equal(await passwordMatches("A-valid-password-123", a), true);
  assert.equal(await passwordMatches("wrong-password", a), false);
  await assert.rejects(() => passwordHash("short"), InputError);
});
