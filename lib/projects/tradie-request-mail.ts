import { sendEmail } from "@/lib/azureClient";
import { classifyGraphSendFailure } from "@/lib/graph/retry";
import type { TradieRequestMailPorts } from "@/lib/domain/tradies/requests";

/**
 * How a tradie request email is sent and how a failure is read — the same for
 * the first send in the Server Action and every retry in the workflow.
 */
export const tradieRequestMail: TradieRequestMailPorts = {
  classifyFailure: classifyGraphSendFailure,
  send: async (email) => {
    try {
      await sendEmail({
        body: email.html,
        cc: email.cc.length > 0 ? [...email.cc] : undefined,
        subject: email.subject,
        to: email.to,
      });
    } catch (error) {
      // The office sees a sentence, never this; it is for whoever reads logs.
      console.error(`Tradie request email to ${email.to} failed:`, error);
      throw error;
    }
  },
};
