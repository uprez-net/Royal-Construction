"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Mic,
  RotateCw,
  Video,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { WhatsAppMediaRecord } from "@/lib/domain/whatsapp/media";
import type { Jsonified } from "@/lib/leads/whatsapp-types";
import { fileKindLabel, formatFileSize } from "@/lib/whatsapp/chat-format";

import { WhatsAppAudioPlayer } from "./media/whatsapp-audio-player";
import { WhatsAppPhoto, WhatsAppSticker } from "./media/whatsapp-image";
import { WhatsAppVideoPlayer } from "./media/whatsapp-video-player";
import { fileHref } from "@/lib/files/file-href";

// One WhatsApp attachment, as it sits inside a bubble: photos and stickers
// through next/image, video and voice notes in the app's own players
// (./media), documents as a file card.
//
// The file is served from Blob storage once the media workflow has copied it.
// Until then it says it is still saving; if the copy failed it says why and
// offers a retry — never a broken image with no explanation.

type Media = Jsonified<WhatsAppMediaRecord>;

const TYPE_LABEL: Record<Media["type"], string> = {
  AUDIO: "audio",
  DOCUMENT: "document",
  IMAGE: "photo",
  STICKER: "sticker",
  VIDEO: "video",
};

function Placeholder({
  media,
  onRetry,
}: {
  media: Media;
  onRetry?: (mediaId: string) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const failed = media.status === "FAILED";
  const label = media.voice ? "voice message" : TYPE_LABEL[media.type];
  const Icon =
    media.type === "IMAGE" || media.type === "STICKER"
      ? ImageIcon
      : media.type === "VIDEO"
        ? Video
        : media.type === "AUDIO"
          ? Mic
          : FileText;

  return (
    <div
      className={cn(
        "flex min-w-[220px] items-center gap-3 rounded-md px-3 py-3",
        failed ? "bg-destructive-light" : "bg-black/[0.04]",
      )}
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-card/80 text-muted-foreground">
        {failed ? (
          <AlertTriangle
            className="size-5 text-destructive-ink"
            aria-hidden="true"
          />
        ) : (
          <Icon className="size-5" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        {failed ? (
          <>
            <p className="font-medium text-foreground">
              Couldn&apos;t save this {label}
            </p>
            <p className="text-muted-foreground">
              {media.failureReason
                ?? "Open WhatsApp on the business phone to view it."}
            </p>
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Saving {label}…
          </p>
        )}
      </div>
      {failed && onRetry ? (
        <button
          type="button"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            onRetry(media.id);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[12px] font-medium text-success-ink shadow-sm hover:bg-muted disabled:opacity-60"
        >
          <RotateCw
            className={cn("size-3.5", retrying && "animate-spin")}
            aria-hidden="true"
          />
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function WhatsAppMedia({
  media,
  onRetry,
}: {
  media: Media;
  onRetry?: (mediaId: string) => void;
}) {
  if (!media.url) return <Placeholder media={media} onRetry={onRetry} />;
  // Stored privately (#571): the browser loads it through the signing route.
  // The photo components take the stored URL and do their own wrapping, so
  // they can also skip the image optimiser.
  const url = fileHref(media.url);

  switch (media.type) {
    case "IMAGE":
      return <WhatsAppPhoto src={media.url} caption={media.caption} />;
    case "STICKER":
      return <WhatsAppSticker src={media.url} />;
    case "VIDEO":
      return <WhatsAppVideoPlayer src={url} caption={media.caption} />;
    case "AUDIO":
      return (
        <WhatsAppAudioPlayer
          src={url}
          seed={media.id}
          voice={media.voice}
          byteSize={media.byteSize}
        />
      );
    case "DOCUMENT": {
      const kind = fileKindLabel(media.fileName, media.mimeType);
      const size = formatFileSize(media.byteSize);
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-60 items-center gap-3 rounded-md bg-black/4 px-3 py-2.5 transition hover:bg-black/7"
        >
          <span
            className={cn(
              "inline-flex h-10 w-8 shrink-0 items-end justify-center rounded-[3px] pb-1 text-[9px] font-bold text-white",
              kind === "PDF"
                ? "bg-destructive"
                : kind.startsWith("XLS")
                  ? "bg-success"
                  : kind.startsWith("DOC")
                    ? "bg-info"
                    : "bg-muted-foreground",
            )}
            aria-hidden="true"
          >
            {kind.slice(0, 4)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] text-foreground">
              {media.fileName ?? "Document"}
            </span>
            <span className="block text-[12px] text-muted-foreground">
              {[kind, size].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Download
            className="size-4.5 shrink-0 text-muted-foreground"
            aria-label="Open"
          />
        </a>
      );
    }
  }
}
