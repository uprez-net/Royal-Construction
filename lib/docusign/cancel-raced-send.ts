import { EnvelopeStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createDocusignContext } from "./client";
import { getDocusignConfig } from "./config";
import { LIVE_ENVELOPE_STATUSES } from "./envelope-status";
import { voidEnvelope } from "./void-envelope";

// No "use server": as a Server Action this would void any envelope for any
// caller. Each send action calls it only for the envelope it has just created.

export const RACED_SEND_CANCELLED_ERROR =
  "A recall or new revision happened while sending, so this envelope was cancelled.";

// A send creates its DocuSign envelope after claiming the offer and before
// recording the envelope. A recall or Create revision in that window finds no
// envelope row to void and moves the offer on, so the envelope just sent is out
// for signature on an offer that no longer expects it. Void it, and write VOIDED
// only once DocuSign confirms: until then the row stays live, so the next
// revision still sees it and tries the void again.
export async function cancelRacedSend(
  docusignId: string,
): Promise<{ ok: false; error: string }> {
  try {
    const context = await createDocusignContext(getDocusignConfig());
    await voidEnvelope(
      context,
      docusignId,
      "Recalled or replaced while it was being sent.",
    );
  } catch (error) {
    console.error(
      `[offer] envelope ${docusignId} was sent during a recall or revision, and DocuSign did not void it:`,
      error,
    );
    return {
      ok: false,
      error: `A recall or new revision happened while sending, and DocuSign did not confirm cancelling envelope ${docusignId}, so the customer may still be able to sign it. Void it in DocuSign before going further.`,
    };
  }
  try {
    await prisma.envelope.updateMany({
      where: { docusignId, status: { in: LIVE_ENVELOPE_STATUSES } },
      data: { status: EnvelopeStatus.VOIDED, voidedAt: new Date() },
    });
  } catch (error) {
    // DocuSign has voided it, and its envelope-voided Connect event records the
    // same status, so this is logged rather than reported as a failed cancel.
    console.error(
      `[offer] envelope ${docusignId} was voided, but recording it failed:`,
      error,
    );
  }
  return { ok: false, error: RACED_SEND_CANCELLED_ERROR };
}
