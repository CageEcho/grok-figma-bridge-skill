import assert from "node:assert/strict";
import test from "node:test";
import { bearerMatches, extractBearer, generateToken } from "../src/auth.mjs";

const TOKEN = "synthetic-test-token-do-not-use-0123456789abcd";
const WRONG = "synthetic-wrong-token-do-not-use-0123456789abcd";

test("bearer comparison accepts only the same token", () => {
  assert.equal(bearerMatches(TOKEN, TOKEN), true);
  assert.equal(bearerMatches(WRONG, TOKEN), false);
  assert.equal(bearerMatches("short", TOKEN), false);
  assert.equal(bearerMatches(TOKEN, "short"), false);
  assert.equal(bearerMatches("", TOKEN), false);
});

test("bearer extraction rejects non-bearer and oversized headers", () => {
  assert.equal(extractBearer(`Bearer ${TOKEN}`), TOKEN);
  assert.equal(extractBearer("Basic abcdefghijklmnop"), null);
  assert.equal(extractBearer(`Bearer ${TOKEN} extra`), null);
  assert.equal(extractBearer(`Bearer ${"a".repeat(300)}`), null);
  assert.equal(extractBearer(undefined), null);
});

test("generated tokens are base64url and long enough to compare", () => {
  const token = generateToken();
  assert.match(token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(bearerMatches(token, token), true);
});
