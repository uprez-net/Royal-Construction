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
        failed ? "bg-[#fde8ec]" : "bg-black/[0.04]",
      )}
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#54656f]">
        {failed ? (
          <AlertTriangle className="size-5 text-[#ea0038]" aria-hidden="true" />
        ) : (
          <Icon className="size-5" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        {failed ? (
          <>
            <p className="font-medium text-[#111b21]">
              Couldn&apos;t save this {label}
            </p>
            <p className="text-[#667781]">
              {media.failureReason
                ?? "Open WhatsApp on the business phone to view it."}
            </p>
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-[#667781]">
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
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-[#008069] shadow-sm hover:bg-[#f0f2f5] disabled:opacity-60"
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
  const url = media.url;

  switch (media.type) {
    case "IMAGE":
      return <WhatsAppPhoto src={url} caption={media.caption} />;
    case "STICKER":
      return <WhatsAppSticker src={url} />;
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
                ? "bg-[#e5464f]"
                : kind.startsWith("XLS")
                  ? "bg-[#1d9d58]"
                  : kind.startsWith("DOC")
                    ? "bg-[#2f6edb]"
                    : "bg-[#8696a0]",
            )}
            aria-hidden="true"
          >
            {kind.slice(0, 4)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] text-[#111b21]">
              {media.fileName ?? "Document"}
            </span>
            <span className="block text-[12px] text-[#667781]">
              {[kind, size].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Download
            className="size-4.5 shrink-0 text-[#54656f]"
            aria-label="Open"
          />
        </a>
      );
    }
  }
}
