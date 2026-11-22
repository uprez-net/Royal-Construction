import { createHash, timingSafeEqual } from "node:crypto";

import type { MiddlewareHandler } from "hono";

// Every /v1 route needs `Authorization: Bearer <BRIDGE_API_TOKEN>`. Compared
// as SHA-256 digests in constant time, so neither the length nor a prefix of
// the token leaks through timing.

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function tokenMatches(
  given: string | null | undefined,
  expected: string,
): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export function bearerAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!tokenMatches(match?.[1]?.trim(), token)) {
      return c.json(
        {
          error: {
            code: "unauthorized",
            message: "Missing or wrong bridge token.",
          },
        },
        401,
      );
    }
    await next();
  };
}
