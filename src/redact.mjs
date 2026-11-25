const BEARER = /Bearer\s+\S+/gi;
const ACCESS_TOKEN = /FIGMA_ACCESS_TOKEN=\S+/g;

export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out.replace(BEARER, "Bearer [redacted]").replace(ACCESS_TOKEN, "FIGMA_ACCESS_TOKEN=[redacted]");
}
