import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import { isBlobStorageUrl } from "@/lib/blob-url";

const EMAIL_ATTACHMENT_PREFIX = "/email-ad-hock-attachment-upload/";

export type EmailSendInput = {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
};

export type EmailSendPort = (input: EmailSendInput) => Promise<void>;

/** Authorize deletion of only the email composer’s own Blob namespace. */
export function authorizeEmailAttachmentDeletion(
  principal: DomainPrincipal,
  blobUrl: string,
): { blobUrl: string } {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Email attachment management requires internal staff access.",
    );
  }
  let pathname: string;
  try {
    const parsed = new URL(blobUrl);
    pathname = parsed.pathname;
  } catch {
    throw new DomainValidationError("The Blob URL is invalid.", "blobUrl");
  }
  if (!isBlobStorageUrl(blobUrl) || !pathname.startsWith(EMAIL_ATTACHMENT_PREFIX)) {
    throw new DomainAuthorizationError(
      "Only an uploaded email attachment can be removed here.",
    );
  }
  return { blobUrl };
}

/** Send one campaign email through the injected Graph/mail capability. */
export async function sendCampaignEmail(
  principal: DomainPrincipal,
  input: EmailSendInput,
  send: EmailSendPort,
): Promise<boolean> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Campaign email requires internal staff access.",
    );
  }
  const to = input.to.trim();
  if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
    throw new DomainValidationError("A valid recipient email is required.", "to");
  }
  await send({ ...input, to });
  return true;
}
