const SESSION_PATH_PATTERN = /\/session\/([^/?#]+)(?:\/|$)/;

export function getEveSessionIdFromRequest(request: Request): string | null {
  const match = new URL(request.url).pathname.match(SESSION_PATH_PATTERN);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function isAgentFeatureEnabled(
  value = process.env.EVE_OPERATIONS_AGENT_ENABLED,
): boolean {
  return value === "true";
}
