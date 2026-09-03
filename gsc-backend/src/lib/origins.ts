export function getTrustedOrigins(): string[] {
  const raw = [process.env.FRONTEND_URL, process.env.ALLOWED_ORIGINS]
    .filter((v): v is string => Boolean(v && v.trim().length))
    .join(",");

  const candidates = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const origins: string[] = [];
  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(
        `Invalid origin in FRONTEND_URL/ALLOWED_ORIGINS: "${candidate}"`,
      );
    }
    origins.push(parsed.origin);
  }

  return [...new Set(origins)];
}
