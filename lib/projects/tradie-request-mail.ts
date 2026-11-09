import { sendEmail } from "@/lib/azureClient";
import { toEmailAttachment } from "@/lib/compliance/party-mail";
import { classifyGraphSendFailure } from "@/lib/graph/retry";
import type { TradieRequestMailPorts } from "@/lib/domain/tradies/requests";

/**
 * Reading an attached file back from storage failed, so nothing reached the
 * mail server: safe for the workflow to try again.
 */
class AttachmentReadError extends Error {}

/**
 * How a tradie request email is sent and how a failure is read — the same for
 * the first send in the Server Action and every retry in the workflow.
 */
export const tradieRequestMail: TradieRequestMailPorts = {
  classifyFailure: (error) =>
    error instanceof AttachmentReadError
      ? "transient"
      : classifyGraphSendFailure(error),
  send: async (email) => {
    try {
      // Read at send time rather than stored: the blob is already durable, and
      // a retry hours later sends the same files.
      const attachments = await Promise.all(
        email.attachments.map((file) => toEmailAttachment(file)),
      ).catch((error: unknown) => {
        throw new AttachmentReadError(
          error instanceof Error ? error.message : String(error),
        );
      });
      await sendEmail({
        attachments: attachments.length > 0 ? attachments : undefined,
        body: email.html,
        cc: email.cc.length > 0 ? [...email.cc] : undefined,
        subject: email.subject,
        to: email.to,
      });
    } catch (error) {
      // The office sees a sentence, never this; it is for whoever reads logs.
      console.error("Tradie request email failed:", error);
      throw error;
    }
  },
};
