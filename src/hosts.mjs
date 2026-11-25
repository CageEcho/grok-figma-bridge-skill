const DNS_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;

export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function parseAllowedHosts(value) {
  const out = [...LOOPBACK_HOSTS];
  if (value == null || value === "") return out;
  if (typeof value !== "string") {
    throw new Error("Allowed hosts must be a comma-separated list of bare hostnames.");
  }
  for (const raw of value.split(",")) {
    const host = raw.trim().toLowerCase();
    if (host === "") continue;
    if (host.includes("*") || host.includes("/") || host.includes("@") || host.includes(" ") || host.includes("\\")) {
      throw new Error("Refusing an allowed host that is not a bare hostname. The value was not printed.");
    }
    if (LOOPBACK_HOSTS.includes(host)) continue;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === "::" || host === "0.0.0.0") {
      throw new Error("Refusing a non-loopback IP in allowed hosts.");
    }
    if (!DNS_NAME.test(host)) {
      throw new Error("Refusing an allowed host that is not a DNS name. The value was not printed.");
    }
    if (!out.includes(host)) out.push(host);
  }
  return out;
}

export function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
