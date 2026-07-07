"use server";

import { auth } from "@clerk/nextjs/server";
import { generateImage } from "ai";
import { put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { gateway } from "@/lib/model";
import type { OfferImageSlotKey } from "@/lib/offer/workspace-images";

// Base prompt per slot. AI images are inspiration/concept only — never real
// completed work — so the offer captions them accordingly (see offerImageCaption).
const SLOT_PROMPTS: Record<OfferImageSlotKey, string> = {
  hero: "Photorealistic street-view exterior of a modern Australian {buildType}, rendered facade, double garage, daytime, no people, no text, no logos.",
  exterior:
    "Photorealistic full facade of a modern Australian {buildType}, rendered exterior, feature entry, double garage, no text, no logos.",
  render:
    "Architectural 3D render perspective of a modern Australian double storey home facade, clean render style, no text, no logos.",
  kitchen:
    "Photorealistic modern kitchen with white shaker cabinetry, stone island benchtop, herringbone timber floor, natural light, no text, no logos.",
  living:
    "Photorealistic open-plan living room, herringbone timber flooring, neutral palette, large windows, styled, no text, no logos.",
  bedroom:
    "Photorealistic master bedroom, soft carpet, tray ceiling, plantation shutters, styled, warm light, no text, no logos.",
  bathroom:
    "Photorealistic modern bathroom, floor-to-ceiling stone-look tiles, freestanding bath, semi-frameless shower, no text, no logos.",
};

const WIDE_SLOTS: ReadonlySet<OfferImageSlotKey> = new Set([
  "hero",
  "exterior",
  "render",
]);

type GenerateResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function generateOfferInspirationImage(input: {
  slotKey: OfferImageSlotKey;
  buildType: string;
}): Promise<GenerateResult> {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  const prompt = SLOT_PROMPTS[input.slotKey].replace(
    "{buildType}",
    input.buildType || "double storey home",
  );

  try {
    const { image } = await generateImage({
      model: gateway.image("google/imagen-4.0-fast-generate-001"),
      prompt,
      aspectRatio: WIDE_SLOTS.has(input.slotKey) ? "16:9" : "4:3",
    });
    if (!image?.base64) {
      return { ok: false, error: "Image generation returned no data" };
    }
    const contentType = image.mediaType || "image/png";
    const buffer = Buffer.from(image.base64, "base64");
    const hash = createHash("sha256").update(buffer).digest("hex");
    const extension = contentType === "image/jpeg" ? "jpg" : "png";
    const blob = await put(`offer-ai/${hash}.${extension}`, buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return { ok: true, url: blob.url };
  } catch (error) {
    return { ok: false, error: (error as Error).message || "Generation failed" };
  }
}
