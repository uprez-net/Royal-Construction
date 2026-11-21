import {
  getContentType,
  normalizeMessageContent,
  type proto,
  type WAMessage,
} from "baileys";

import type { MediaKind } from "../events/types.js";

// A WhatsApp message, reduced to what the app stores: text, a file's
// description, or "something arrived that the app does not show". Pure, so
// the shapes WhatsApp sends are pinned by tests rather than discovered live.

/** Not something a person wrote: protocol traffic, reactions, key exchange. */
const SKIPPED = new Set<string>([
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "keepInChatMessage",
  "pinInChatMessage",
  "encReactionMessage",
  "pollUpdateMessage",
  "encEventResponseMessage",
]);

const MEDIA: Record<string, MediaKind> = {
  audioMessage: "audio",
  documentMessage: "document",
  imageMessage: "image",
  stickerMessage: "sticker",
  videoMessage: "video",
};

export type NormalisedContent =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "media";
      readonly text: string;
      readonly media: {
        readonly kind: MediaKind;
        readonly mimeType: string | null;
        readonly fileName: string | null;
        readonly caption: string | null;
        readonly voice: boolean;
        readonly byteSize: number | null;
        readonly sha256: string | null;
      };
    }
  | { readonly kind: "unsupported"; readonly type: string };

function toNumber(value: number | { toNumber(): number } | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(number) ? number : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The message's content, or null when there is nothing a person wrote. */
export function normaliseContent(
  message: proto.IMessage | null | undefined,
): NormalisedContent | null {
  const content = normalizeMessageContent(message);
  if (!content) return null;
  const type = getContentType(content);
  if (!type || SKIPPED.has(type)) return null;

  if (type === "conversation") {
    const body = text(content.conversation);
    return body ? { kind: "text", text: body } : null;
  }
  if (type === "extendedTextMessage") {
    const body = text(content.extendedTextMessage?.text);
    return body ? { kind: "text", text: body } : null;
  }

  const mediaKind = MEDIA[type];
  if (mediaKind) {
    const inner = content[type as keyof proto.IMessage] as
      | (proto.Message.IImageMessage
          & proto.Message.IVideoMessage
          & proto.Message.IAudioMessage
          & proto.Message.IDocumentMessage
          & proto.Message.IStickerMessage)
      | null
      | undefined;
    const caption = text(inner?.caption);
    const sha = inner?.fileSha256;
    return {
      kind: "media",
      media: {
        byteSize: toNumber(inner?.fileLength),
        caption,
        fileName: mediaKind === "document" ? text(inner?.fileName) : null,
        kind: mediaKind,
        mimeType: text(inner?.mimetype),
        sha256:
          sha && sha.length > 0 ? Buffer.from(sha).toString("base64") : null,
        voice: mediaKind === "audio" && Boolean(inner?.ptt),
      },
      text: caption ?? "",
    };
  }

  return { kind: "unsupported", type };
}

/** When the message was sent, from WhatsApp's seconds-since-epoch. */
export function messageSentAt(
  message: WAMessage,
  fallback = new Date(),
): string {
  const seconds = toNumber(
    message.messageTimestamp as
      | number
      | { toNumber(): number }
      | null
      | undefined,
  );
  return seconds
    ? new Date(seconds * 1000).toISOString()
    : fallback.toISOString();
}
