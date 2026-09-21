"use server";

import { generateImage } from "ai";
import { put } from "@vercel/blob";

import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { generateOfferImage } from "@/lib/domain/offers/images";
import { userPrincipal } from "@/lib/domain/principal";
import { gateway } from "@/lib/model";
import prisma from "@/lib/prisma";
import type { OfferImageSlotKey } from "@/lib/offer/workspace-images";

type GenerateResult = { ok: true; url: string } | { ok: false; error: string };

export async function generateOfferInspirationImage(input: {
  attemptId: string;
  slotKey: OfferImageSlotKey;
  buildType: string;
  finishContext?: string;
}): Promise<GenerateResult> {
  const access = await requireInternalUser();
  if (!access.ok) return { error: access.error, ok: false };
  try {
    return await generateOfferImage(userPrincipal(access.user), input, prisma, {
      generate: async ({ aspectRatio, prompt }) => {
        const { image } = await generateImage({
          aspectRatio,
          model: gateway.image("google/imagen-4.0-fast-generate-001"),
          prompt,
        });
        return {
          base64: image?.base64 ?? "",
          mediaType: image?.mediaType ?? null,
        };
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
      error: (error as Error).message || "Generation failed",
      ok: false,
    };
  }
}
