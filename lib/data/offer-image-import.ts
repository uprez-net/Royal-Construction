"use server";

import { head, put } from "@vercel/blob";

import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { isDomainError } from "@/lib/domain/errors";
import { importOfferImage } from "@/lib/domain/offers/images";
import { userPrincipal } from "@/lib/domain/principal";

type ImportResult =
  | { ok: true; url: string; deduped: boolean }
  | { ok: false; error: string };

export async function importDropboxImage(input: {
  url: string;
  fileName: string;
}): Promise<ImportResult> {
  const access = await requireInternalUser();
  if (!access.ok) return { error: access.error, ok: false };
  try {
    return await importOfferImage(userPrincipal(access.user), input, {
      fetch: async (url) => {
        const response = await fetch(url);
        return {
          body: new Uint8Array(await response.arrayBuffer()),
          contentType: response.headers.get("content-type"),
          ok: response.ok,
          status: response.status,
        };
      },
      head: async (pathname) => {
        try {
          const blob = await head(pathname);
          return blob?.url ? { url: blob.url } : null;
        } catch {
          return null;
        }
      },
      put: async ({ allowOverwrite, body, contentType, pathname }) => {
        const putBody =
          body instanceof Uint8Array && !Buffer.isBuffer(body)
            ? Buffer.from(body)
            : body;
        return put(pathname, putBody, {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite,
          contentType,
        });
      },
    });
  } catch (error) {
    return {
      error:
        isDomainError(error) || error instanceof Error
          ? error.message
          : "Import failed",
      ok: false,
    };
  }
}
