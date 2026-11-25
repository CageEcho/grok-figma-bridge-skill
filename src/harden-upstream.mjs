import { createHash } from "node:crypto";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function countOf(source, needle) {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const index = source.indexOf(needle, from);
    if (index < 0) return count;
    count += 1;
    from = index + needle.length;
  }
}

export function applySourcePatch(source, pin) {
  const text = String(source);
  const ctorCount = countOf(text, "new WebSocketServer(");
  if (ctorCount !== 1) {
    throw new Error(`Fail closed: expected exactly one WebSocketServer construction, found ${ctorCount}.`);
  }
  const unpatchedCount = countOf(text, pin.unpatchedLine);
  const patchedCount = countOf(text, pin.patchedLine);
  if (unpatchedCount === 1 && patchedCount === 0) {
    return { changed: true, source: text.replace(pin.unpatchedLine, pin.patchedLine) };
  }
  if (unpatchedCount === 0 && patchedCount === 1) {
    return { changed: false, source: text };
  }
  throw new Error(
    "Fail closed: plugin-bridge.ts does not match the pinned WebSocketServer line. Refusing to build a different version.",
  );
}

export function assertBundledLoopback(javascript) {
  const calls = String(javascript).match(/new WebSocketServer\(\{[^}]*\}\)/g) ?? [];
  if (calls.length !== 1) {
    throw new Error(
      `Fail closed: expected exactly one bundled WebSocketServer construction, found ${calls.length}.`,
    );
  }
  if (!/host\s*:\s*["']127\.0\.0\.1["']/.test(calls[0])) {
    throw new Error("Fail closed: bundled WebSocketServer is missing host 127.0.0.1.");
  }
  if (/new WebSocketServer\(\{\s*port\s*:\s*[^,}]+\s*\}\)/.test(javascript)) {
    throw new Error("Fail closed: an unpatched WebSocketServer construction remains in the bundle.");
  }
}

export function assertManifestLoopback(manifest) {
  const domains = manifest?.networkAccess?.allowedDomains;
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error("Fail closed: plugin manifest has no networkAccess.allowedDomains list.");
  }
  for (const domain of domains) {
    if (typeof domain !== "string" || !/^wss?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain)) {
      throw new Error("Fail closed: plugin manifest allows a non-loopback domain. The domain was not printed.");
    }
  }
}
