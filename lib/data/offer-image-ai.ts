"use server";

import { generateText } from "ai";
import { put } from "@/lib/blob";

import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { generateOfferImage } from "@/lib/domain/offers/images";
import { userPrincipal } from "@/lib/domain/principal";
import { domainActionFailure } from "@/lib/http/domain-response";
import { gateway } from "@/lib/model";
import {
  OFFER_IMAGE_GENERATION_FAILED,
  OFFER_IMAGE_MODEL_ID,
} from "@/lib/offer/offer-image-model";
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
        // A Gemini image model is a language model on the gateway: it answers
        // generateText with image files, and gateway.image() refuses it.
        const { files } = await generateText({
          model: gateway(OFFER_IMAGE_MODEL_ID),
          prompt,
          providerOptions: {
            google: {
              imageConfig: { aspectRatio },
              responseModalities: ["IMAGE"],
            },
          },
        });
        const image = files.find((file) => file.mediaType.startsWith("image/"));
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
          access: "private",
          addRandomSuffix: false,
          allowOverwrite,
          contentType,
        });
      },
    });
  } catch (error) {
    // A refusal the domain can name (no attempt id, an attempt already in
    // flight) is worded for the estimator; a provider failure is not.
    const refusal = domainActionFailure(error);
    if (refusal) return { error: refusal.error, ok: false };
    // Selected fields only: a provider error can carry the request body and
    // response headers, which do not belong in the log.
    const failure = error instanceof Error ? error : null;
    const statusCode =
      failure && "statusCode" in failure ? failure.statusCode : undefined;
    console.error("[offer-image-ai] image generation failed", {
      model: OFFER_IMAGE_MODEL_ID,
      slotKey: input.slotKey,
      name: failure?.name ?? typeof error,
      message: failure?.message,
      statusCode,
    });
    return { error: OFFER_IMAGE_GENERATION_FAILED, ok: false };
  }
}
