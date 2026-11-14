"use client";

import { useState } from "react";
import Image from "next/image";
import { Download } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Photos and stickers through next/image. The Blob host is already allowed in
// next.config.ts `images.remotePatterns`, so the optimiser serves a resized
// WebP/AVIF for the bubble and a larger one for the lightbox instead of the
// phone's full-size original.

/** The bubble's photo; opens the lightbox. Keeps the photo's own shape. */
export function WhatsAppPhoto({
  src,
  caption,
}: {
  src: string;
  caption: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const alt = caption ?? "Photo sent on WhatsApp";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "relative block w-full min-w-50 max-w-82.5 overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-[#00a884]",
          !loaded && "min-h-40 animate-pulse bg-black/6",
        )}
        aria-label={caption ? `Open photo: ${caption}` : "Open photo"}
      >
        <Image
          src={src}
          alt={alt}
          // The real proportions aren't known until it loads; these reserve a
          // square and `h-auto` then follows the photo's own shape.
          width={330}
          height={330}
          sizes="(max-width: 640px) 80vw, 330px"
          onLoad={() => setLoaded(true)}
          className={cn(
            "h-auto max-h-82.5 w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(94vw,1200px)] border-0 bg-black/95 p-2 sm:p-4">
          <DialogTitle className="sr-only">Photo</DialogTitle>
          <DialogDescription className="sr-only">{alt}</DialogDescription>
          <div className="relative h-[78vh] w-full">
            <Image
              src={src}
              alt={alt}
              fill
              sizes="94vw"
              className="rounded-md object-contain"
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-1 pt-2 text-sm text-white/80">
            <span className="truncate">{caption}</span>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              download
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
            >
              <Download className="size-4" aria-hidden="true" />
              Original
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A sticker: small, no bubble behind it. Served unoptimised because stickers
 * are often animated WebP, which the optimiser would flatten to one frame.
 */
export function WhatsAppSticker({ src }: { src: string }) {
  return (
    <Image
      src={src}
      alt="Sticker"
      width={128}
      height={128}
      unoptimized
      className="size-32 object-contain"
    />
  );
}
