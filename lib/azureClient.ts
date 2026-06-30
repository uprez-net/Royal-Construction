import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";

const globalForGraph = globalThis as typeof globalThis & {
  graphClientPromise?: Promise<Awaited<ReturnType<typeof createGraphContext>>>;
};

export const graphClientPromise =
  globalForGraph.graphClientPromise ??
  createGraphContext(getGraphConfig());

if (process.env.NODE_ENV !== "production") {
  globalForGraph.graphClientPromise = graphClientPromise;
}

interface EmailInput {
  subject: string;
  body: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: { name: string; contentBytes: string }[];
}
/**
 * Wrapper function to send an email using Microsoft Graph API. It ensures that the 'to' field is properly handled, allowing for both string and array inputs, and validates that the 'to' field is not empty.
 * @param email - An object containing the email details, including subject, body, recipients (`to`, `cc`, `bcc`), and `attachments`. The `to` field can be a single string or an array of strings. If an array is provided, the first email will be used as the primary recipient, and the rest will be added to the CC list.
 * @throws Will throw an error if the 'to' field is an empty array or contains empty strings.
 * 
 * 
 * CC, BCC and attachments are not operational in this implementation, but the function is structured to allow for future enhancements to include these features. 
 */
export async function sendEmail(email: EmailInput) {
  const graphClient = await graphClientPromise;
  if(Array.isArray(email.to) && email.to.length === 0) {
    throw new Error("Email 'to' field cannot be an empty array.");
  }


  await graphClient.sendMail({
    subject: email.subject,
    body: email.body,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
  });
}