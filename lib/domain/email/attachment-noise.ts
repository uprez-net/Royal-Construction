/**
 * Which email attachments are the sender's signature rather than something
 * they sent us.
 *
 * Every mail path that stores attachments asks this one question: inbound
 * lead, certifier and consultant mail, offer replies, tradie invoices, and the
 * sent-mail sync. It used to be a 40 KB inline cut copied into four of them,
 * and that let two kinds of logo through, both stored to Blob on every message
 * of a thread and, on the compliance tab, queued as documents to identify:
 *
 *   - A signature banner over 40 KB. High-resolution logos and "award" strips
 *     routinely are.
 *   - An embedded image Graph reports as not inline. Outlook's `image001.png`
 *     comes through with `isInline: false` on many replies from outside the
 *     tenant, even though the body refers to it by Content-ID.
 *
 * A pasted photo is still kept: it is an image, often embedded, but it is
 * hundreds of kilobytes, and on a lead it can be the whole enquiry. Size is
 * what separates the two, as it was before.
 */

/** The attachment fields the rule reads; every mail port's metadata has them. */
export type AttachmentNoiseInput = {
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly isInline: boolean;
  /** Graph's `contentId`: set when the body can refer to the file. */
  readonly contentId?: string | null;
};

/** Any inline file this small is a logo, an icon or a tracking pixel. */
export const MIN_INLINE_BYTES = 40 * 1024;

/**
 * An embedded image under this is a signature, not a photo. Signature banners
 * top out around here; a phone photo or a screenshot of a plan is well over.
 */
export const MAX_SIGNATURE_IMAGE_BYTES = 150 * 1024;

/** How Outlook names images it embeds: image001.png, Outlook-a1b2c3.png. */
const EMBEDDED_IMAGE_NAME =
  /^(image\d{3}|outlook-[\w-]+)\.(png|jpe?g|gif|bmp)$/i;

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i;

function isImage(attachment: AttachmentNoiseInput) {
  const declared = (attachment.contentType ?? "").toLowerCase();
  return declared.startsWith("image/") || IMAGE_EXTENSION.test(attachment.name);
}

/** True when the attachment is signature or tracking noise, not worth storing. */
export function isSignatureNoise(attachment: AttachmentNoiseInput): boolean {
  if (attachment.isInline && attachment.size < MIN_INLINE_BYTES) {
    return true;
  }

  if (!isImage(attachment) || attachment.size >= MAX_SIGNATURE_IMAGE_BYTES) {
    return false;
  }

  return (
    attachment.isInline
    || Boolean(attachment.contentId?.trim())
    || EMBEDDED_IMAGE_NAME.test(attachment.name.trim())
  );
}
