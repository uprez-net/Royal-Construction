import { createHash } from "node:crypto";
import { OutboxEventKind } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import type { BlobHeadPort, BlobPutPort } from "../ports/blob";
import type {
  OfferImageAiPort,
  OfferImageFetchPort,
} from "../ports/offer-images";
import { isOfficePrincipal, type DomainPrincipal } from "../principal";
import type { OfferImageSlotKey } from "@/lib/offer/workspace-images";

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const EXT_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ALLOWED_IMAGE_HOSTS = new Set([
  "content.dropboxapi.com",
  "dropbox.com",
  "www.dropbox.com",
]);
const SLOT_PROMPTS: Record<OfferImageSlotKey, string> = {
  hero: "Photorealistic street-view exterior of a modern Australian {buildType}, rendered facade, double garage, daytime, no people, no text, no logos.",
  exterior:
    "Photorealistic full facade of a modern Australian {buildType}, rendered exterior, feature entry, double garage, no text, no logos.",
  render:
    "Architectural 3D render perspective of a modern Australian {buildType} facade, clean render style, no text, no logos.",
  kitchen:
    "Photorealistic modern kitchen with white shaker cabinetry, stone island benchtop, large-format porcelain tile floor, natural light, no text, no logos.",
  living:
    "Photorealistic open-plan living room, large-format porcelain tile flooring, neutral palette, large windows, styled, no text, no logos.",
  bedroom:
    "Photorealistic master bedroom, soft carpet, tray ceiling, plantation shutters, styled, warm light, no text, no logos.",
  bathroom:
    "Photorealistic modern bathroom, floor-to-ceiling stone-look tiles, freestanding bath, semi-frameless shower, no text, no logos.",
};
const WIDE_SLOTS: ReadonlySet<OfferImageSlotKey> = new Set([
  "exterior",
  "hero",
  "render",
]);

function requireInternal(principal: DomainPrincipal): void {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError("Unauthorized");
  }
}

function allowedDropboxUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:"
      && (ALLOWED_IMAGE_HOSTS.has(host)
        || host.endsWith(".dropboxusercontent.com"))
    );
  } catch {
    return false;
  }
}

function extensionFromName(fileName: string): string {
  return /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "jpg";
}

export async function importOfferImage(
  principal: DomainPrincipal,
  input: { readonly fileName: string; readonly url: string },
  ports: {
    readonly fetch: OfferImageFetchPort;
    readonly head: BlobHeadPort;
    readonly put: BlobPutPort;
  },
) {
  requireInternal(principal);
  if (!allowedDropboxUrl(input.url)) {
    throw new DomainValidationError("Image URL must be an https Dropbox link");
  }
  const response = await ports.fetch(input.url);
  if (!response.ok) {
    throw new DomainValidationError(
      `Could not fetch file (${response.status})`,
    );
  }
  const contentType = (response.contentType ?? "image/jpeg").split(";")[0];
  if (!contentType.startsWith("image/")) {
    throw new DomainValidationError("Selected file is not an image");
  }
  if (response.body.byteLength > MAX_IMAGE_BYTES) {
    throw new DomainValidationError("Image exceeds the 40MB limit");
  }
  const hash = createHash("sha256").update(response.body).digest("hex");
  const extension =
    EXT_BY_CONTENT_TYPE[contentType] ?? extensionFromName(input.fileName);
  const pathname = `offer-gallery/${hash}.${extension}`;
  const existing = await ports.head(pathname);
  if (existing) return { deduped: true, ok: true as const, url: existing.url };
  const blob = await ports.put({
    allowOverwrite: true,
    body: response.body,
    contentType,
    pathname,
  });
  return { deduped: false, ok: true as const, url: blob.url };
}

export async function generateOfferImage(
  principal: DomainPrincipal,
  input: {
    readonly attemptId: string;
    readonly buildType: string;
    readonly finishContext?: string;
    readonly slotKey: OfferImageSlotKey;
  },
  db: DomainDb,
  ports: { readonly generate: OfferImageAiPort; readonly put: BlobPutPort },
) {
  requireInternal(principal);
  if (!input.attemptId.trim()) {
    throw new DomainValidationError(
      "An image generation attempt id is required.",
    );
  }
  const base = SLOT_PROMPTS[input.slotKey].replace(
    "{buildType}",
    input.buildType || "double storey home",
  );
  const finish = input.finishContext?.trim();
  const prompt = finish
    ? `${base} Reflect these selected finishes where visible: ${finish}.`
    : base;
  const outcome = await runOutboxEffectWithOutcome(
    db,
    {
      key: `offer-image:${input.attemptId}`,
      kind: OutboxEventKind.OFFER_IMAGE_GENERATE,
      payload: {
        buildType: input.buildType,
        finishContext: finish ?? null,
        slotKey: input.slotKey,
      },
    },
    async () => {
      const image = await ports.generate({
        aspectRatio: WIDE_SLOTS.has(input.slotKey) ? "16:9" : "4:3",
        prompt,
      });
      if (!image.base64) {
        throw new DomainValidationError("Image generation returned no data");
      }
      const contentType = image.mediaType || "image/png";
      const body = Buffer.from(image.base64, "base64");
      const hash = createHash("sha256").update(body).digest("hex");
      const extension = contentType === "image/jpeg" ? "jpg" : "png";
      const blob = await ports.put({
        allowOverwrite: true,
        body,
        contentType,
        pathname: `offer-ai/${hash}.${extension}`,
      });
      return { url: blob.url };
    },
  );
  return {
    ok: true as const,
    replayed: outcome.replayed,
    url: outcome.result.url,
  };
}
