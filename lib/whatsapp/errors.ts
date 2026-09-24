// Meta's WhatsApp error codes, in words an office can act on (issue #333).
//
// Used by the send adapter (a refused request) and the webhook (a "failed"
// delivery status), so a message that fails either way reads the same in the
// thread. Codes from Meta's Cloud API error reference; anything unlisted falls
// back to Meta's own title with the code, which is still better than
// "Something went wrong".

const DESCRIPTIONS: Record<string, string> = {
  "0": "WhatsApp rejected the access token. An administrator needs to renew WHATSAPP_ACCESS_TOKEN.",
  "10": "The WhatsApp access token is missing a permission. An administrator needs to check the system user's access.",
  "100": "WhatsApp rejected the request as invalid.",
  "190":
    "The WhatsApp access token has expired or was revoked. An administrator needs to renew WHATSAPP_ACCESS_TOKEN.",
  "200":
    "The WhatsApp access token is missing a permission. An administrator needs to check the system user's access.",
  "368":
    "The WhatsApp Business account is temporarily blocked for a policy violation.",
  "130429":
    "WhatsApp's sending rate limit was reached. Wait a minute and try again.",
  "130472":
    "Meta held this message back as part of an experiment on marketing messages. Try again later or use another channel.",
  "131000": "WhatsApp had an internal problem with this message.",
  "131005": "The WhatsApp access token isn't allowed to send from this number.",
  "131008": "The message was missing something WhatsApp requires.",
  "131009": "WhatsApp rejected one of the message's values.",
  "131021": "The customer's number is the business number itself.",
  "131026":
    "WhatsApp couldn't deliver to this number — it may not be on WhatsApp, or the customer needs to update their app.",
  "131030":
    "This number isn't on the test-recipient list for the WhatsApp sandbox number.",
  "131031":
    "The WhatsApp Business account is locked. An administrator needs to check WhatsApp Manager.",
  "131042": "There's a payment problem on the WhatsApp Business account.",
  "131047":
    "More than 24 hours have passed since the customer last wrote, so only an approved template can be sent.",
  "131048":
    "WhatsApp has limited this number because of spam reports. Sending is paused.",
  "131049":
    "Meta chose not to deliver this message to keep engagement healthy. Try again later or use another channel.",
  "131050": "The customer has stopped marketing messages from this business.",
  "131051": "That message type isn't supported.",
  "131056":
    "Too many messages to this customer in a short time. Wait a few minutes and try again.",
  "132000":
    "The template's values don't match what Meta approved. The template catalogue needs checking.",
  "132001":
    "That template doesn't exist in this WhatsApp account in that language.",
  "132005": "The template is too long once its values are filled in.",
  "132007": "The template's text breaks WhatsApp's formatting rules.",
  "132012": "A template value isn't in the format Meta approved.",
  "132015": "That template is paused by Meta because of low quality.",
  "132016": "That template has been disabled by Meta.",
  "132018": "A template value contains a line break, a tab or too many spaces.",
  "133010": "The business number isn't registered with the WhatsApp Cloud API.",
};

/** Operator-readable text for a Meta error code. */
export function describeWhatsAppError(
  code: string | number | null | undefined,
  fallbackTitle?: string | null,
): string {
  const key = code === null || code === undefined ? "" : String(code);
  const known = DESCRIPTIONS[key];
  if (known) return known;
  const title = fallbackTitle?.trim();
  if (title && key)
    return `WhatsApp refused the message: ${title} (code ${key}).`;
  if (title) return `WhatsApp refused the message: ${title}.`;
  if (key) return `WhatsApp refused the message (code ${key}).`;
  return "WhatsApp refused the message.";
}
