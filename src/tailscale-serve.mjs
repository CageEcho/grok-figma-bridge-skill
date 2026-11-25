export function buildServeArgs(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Tailscale Serve needs the gateway TCP port (1-65535).");
  }
  return ["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`];
}

export function buildServeOffArgs() {
  return ["serve", "--https=443", "off"];
}

export function assertServeStatusIsPrivate(statusText) {
  const text = String(statusText);
  if (/\bfunnel\b/i.test(text)) {
    throw new Error(
      "Tailscale status mentions Funnel. This package refuses to continue. Turn Funnel off and use only tailscale serve on the private tailnet.",
    );
  }
}
