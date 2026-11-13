import { reportExternalError } from "@/lib/observability/external";
import { createGraphContext, type EmailAttachment } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";

const globalForGraph = globalThis as typeof globalThis & {
  graphClientPromise?: Promise<Awaited<ReturnType<typeof createGraphContext>>>;
};

export const graphClientPromise =
  globalForGraph.graphClientPromise ?? createGraphContext(getGraphConfig());

if (process.env.NODE_ENV !== "production") {
  globalForGraph.graphClientPromise = graphClientPromise;
}

interface EmailInput {
  subject: string;
  body: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
}
/**
 * Wrapper function to send an email using Microsoft Graph API. It ensures that the 'to' field is properly handled, allowing for both string and array inputs, and validates that the 'to' field is not empty.
 * @param email - An object containing the email details, including subject, body, recipients (`to`, `cc`, `bcc`), and `attachments`. The `to` field can be a single string or an array of strings. If an array is provided, the first email will be used as the primary recipient, and the rest will be added to the CC list.
 * @throws Will throw an error if the 'to' field is an empty array or contains empty strings.
 *
 * Attachments are handed to Graph as they are; it sends a large set through an
 * upload session and refuses one over the mailbox's send limit.
 */
export async function sendEmail(email: EmailInput) {
  const toList = (Array.isArray(email.to) ? email.to : [email.to]).filter(
    (addr) => addr?.trim(),
  );
  if (toList.length === 0) {
    throw new Error(
      "Email 'to' field must contain at least one non-empty recipient.",
    );
  }
  const ccList = (
    Array.isArray(email.cc) ? email.cc : email.cc ? [email.cc] : []
  ).filter((addr) => addr?.trim());
  const bccList = (
    Array.isArray(email.bcc) ? email.bcc : email.bcc ? [email.bcc] : []
  ).filter((addr) => addr?.trim());

  // Add CC from .env if it exists (Graph API uses 'optional' type for CC)
  const ccEmail = process.env.MAIL_ID_CC ?? "admin@royalconstructions.com.au";
  // Add RC to the CC list if there are multiple recipients in the 'to' field
  ccList.push(ccEmail);

  // Awaiting the client is inside the try on purpose. It is created once, at
  // import, by acquiring a Graph token; if that fails the promise is rejected
  // for the life of the instance and every send fails here. That is our
  // credential breaking, and it must be reported as such, not be a throw that
  // happens to precede the reporting.
  let operation = "createContext";
  try {
    const graphClient = await graphClientPromise;
    operation = "sendMail";
    await graphClient.sendMail({
      subject: email.subject,
      body: email.body,
      to: toList,
      cc: ccList,
      bcc: bccList,
      attachments: email.attachments,
    });
  } catch (error) {
    // Every client email goes through here, so this is the one place that
    // knows a send failed for a reason on Microsoft's side or ours. Callers
    // still decide what the failure means for their flow. Failing to obtain the
    // client is a failure of the credential whatever status it carries.
    reportExternalError("graph", operation, error, {
      force: operation === "createContext",
    });
    throw error;
  }
}
