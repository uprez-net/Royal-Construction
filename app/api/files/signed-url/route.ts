import { NextResponse } from "next/server";

import { isStoredBlobUrl, signedBlobReadUrl } from "@/lib/blob-port";
import { signedInUserPrincipal } from "@/lib/data/lead-whatsapp-request";
import { authorizeStoredFileRead } from "@/lib/domain/files";
import { domainErrorResponse } from "@/lib/http/domain-response";
import prisma from "@/lib/prisma";
import {
  errorResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * A read-only link to one stored file, valid for fifteen minutes (#571).
 *
 * Every stored file is private, so the URL a row holds opens nothing on its
 * own. A screen that links one points at this route instead (`fileHref` in
 * `lib/files/file-href.ts`), and the route signs it for the caller — after
 * `authorizeStoredFileRead` has run the same access rule as the page.
 *
 *   GET /api/files/signed-url?url=<stored url>            → { url, expiresAt }
 *   GET /api/files/signed-url?url=<stored url>&redirect=1 → 302 to the link
 *
 * The redirect form is what an `<a href>` or `<img src>` uses; the browser
 * keeps the redirect for ten minutes, inside the link's own lifetime, so a
 * list of photos is not re-signed on every render. A public URL (a row from
 * before the move) is already readable and is answered as it is.
 */
const REDIRECT_CACHE_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const redirect = params.get("redirect") === "1";
  try {
    const principal = await signedInUserPrincipal();
    if (!principal) return unauthorizedResponse();
    if (!url || !isStoredBlobUrl(url)) {
      return errorResponse("That is not a file stored by this app.", {
        code: "FILE_URL_INVALID",
        status: 400,
      });
    }
    await authorizeStoredFileRead(principal, url, prisma);
    const signed = await signedBlobReadUrl(url);
    if (redirect) {
      return new NextResponse(null, {
        headers: {
          "Cache-Control": `private, max-age=${REDIRECT_CACHE_SECONDS}`,
          Location: signed.url,
          "Referrer-Policy": "no-referrer",
        },
        status: 302,
      });
    }
    return NextResponse.json(
      {
        expiresAt:
          signed.expiresAt === null
            ? null
            : new Date(signed.expiresAt).toISOString(),
        url: signed.url,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;
    console.error("[files] Failed to sign a stored file link", error);
    return errorResponse("Could not open the file.", {
      code: "FILE_SIGN_FAILED",
      status: 500,
    });
  }
}
