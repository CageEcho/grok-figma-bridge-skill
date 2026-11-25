import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MIN_TOKEN_LENGTH = 32;
export const MAX_TOKEN_LENGTH = 256;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function generateToken() {
  return randomBytes(32).toString("base64url");
}

export function assertTokenShape(token) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new Error(
      `Gateway token must be ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} base64url characters. The value was not printed.`,
    );
  }
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    throw new Error(
      `Gateway token must be ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} characters. The value was not printed.`,
    );
  }
  return token;
}

export function extractBearer(header) {
  if (typeof header !== "string") return null;
  if (header.length > MAX_TOKEN_LENGTH + "Bearer ".length) return null;
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  if (!TOKEN_PATTERN.test(token)) return null;
  if (token.length < 1 || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/**
 * Compare two bearer tokens without short-circuiting on the secret bytes.
 * Both sides are hashed to a fixed length first so a length mismatch cannot
 * skip the comparison or throw from timingSafeEqual.
 */
export function bearerMatches(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string") return false;
  if (!TOKEN_PATTERN.test(expected) || expected.length < MIN_TOKEN_LENGTH) return false;
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
