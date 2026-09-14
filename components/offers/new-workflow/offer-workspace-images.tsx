"use client";

import { upload } from "@vercel/blob/client";
import Image from "next/image";
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { buildBlobPath } from "@/utils/formatters";
import type { ClientPayload } from "@/utils/validators/files";
import { importDropboxImage } from "@/lib/data/offer-image-import";
import { generateOfferInspirationImage } from "@/lib/data/offer-image-ai";
import {
  OFFER_IMAGE_SLOTS,
  type OfferImage,
  type OfferImageMap,
  type OfferImageSlotKey,
} from "@/lib/offer/workspace-images";
import { useDropboxChooser } from "./use-dropbox-chooser";

type OfferWorkspaceImagesProps = {
  readonly images: OfferImageMap;
  readonly onImageChange: (
    key: OfferImageSlotKey,
    image: OfferImage | null,
  ) => void;
  readonly leadId?: number;
  readonly buildType: string;
  // Per-slot visual descriptors of this build's façade/finishes; woven into
  // the AI image prompt so concepts reflect the actual selections.
  readonly finishContexts?: Partial<Record<OfferImageSlotKey, string>>;
  // Which slots have an AI render in flight. Owned by the screen so the spinner
  // survives a trip to another step; only the active step is mounted now, and
  // a lost spinner invites a second click on a render that is still running.
  readonly aiBusy: Partial<Record<OfferImageSlotKey, boolean>>;
  readonly onAiBusyChange: (key: OfferImageSlotKey, busy: boolean) => void;
};

export function OfferWorkspaceImages({
  images,
  onImageChange,
  leadId,
  buildType,
  finishContexts,
  aiBusy,
  onAiBusyChange,
}: OfferWorkspaceImagesProps) {
  const [uploading, setUploading] = useState<
    Partial<Record<OfferImageSlotKey, boolean>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [dropboxBusy, setDropboxBusy] = useState(false);
  const { configured: dropboxConfigured, ready: dropboxReady, choose } =
    useDropboxChooser();

  async function handleGenerate(key: OfferImageSlotKey) {
    setError(null);
    onAiBusyChange(key, true);
    try {
      const result = await generateOfferInspirationImage({
        slotKey: key,
        buildType,
        finishContext: finishContexts?.[key],
      });
      if (result.ok) {
        onImageChange(key, { url: result.url, source: "ai" });
      } else {
        setError(result.error);
      }
    } finally {
      onAiBusyChange(key, false);
    }
  }

  async function handleDropbox() {
    setError(null);
    const files = await choose();
    if (files.length === 0) {
      return;
    }
    setDropboxBusy(true);
    try {
      // Fill the currently-empty slots in order (hero first, then gallery).
      const emptySlots = OFFER_IMAGE_SLOTS.filter((slot) => !images[slot.key]);
      const count = Math.min(files.length, emptySlots.length);
      for (let index = 0; index < count; index += 1) {
        const result = await importDropboxImage({
          url: files[index].link,
          fileName: files[index].name,
        });
        if (result.ok) {
          onImageChange(emptySlots[index].key, {
            url: result.url,
            source: "dropbox",
          });
        } else {
          setError(result.error);
        }
      }
      if (files.length > emptySlots.length) {
        setError(
          `Added ${count} photo(s) to empty slots; ${
            files.length - emptySlots.length
          } extra skipped — remove a photo to add more.`,
        );
      }
    } finally {
      setDropboxBusy(false);
    }
  }

  async function handleFile(key: OfferImageSlotKey, file: File) {
    setError(null);
    setUploading((current) => ({ ...current, [key]: true }));
    try {
      const fileId = uuidv4();
      const leadIdStr = leadId != null ? String(leadId) : undefined;
      const result = await upload(
        buildBlobPath({ fileId, fileName: file.name, leadId: leadIdStr }),
        file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            fileId,
            fileName: file.name,
            fileSize: file.size,
            isOfferFile: true,
            leadId: leadIdStr,
          } satisfies ClientPayload),
        },
      );
      onImageChange(key, { url: result.url, source: "upload" });
    } catch (uploadError) {
      setError((uploadError as Error).message || "Upload failed");
    } finally {
      setUploading((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-lg font-semibold text-foreground">
            Proposal photos
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Attach the hero image, architect render and finished-home gallery.
            Each appears on the generated proposal; empty slots show a
            placeholder.
          </p>
        </div>
        {dropboxConfigured ? (
          <button
            className="inline-flex shrink-0 items-center rounded-md border border-royal-gold bg-white px-3 py-1.5 text-xs font-semibold text-royal-gold-dark hover:bg-royal-gold-light/40 disabled:opacity-50"
            disabled={!dropboxReady || dropboxBusy}
            onClick={() => void handleDropbox()}
            type="button"
          >
            {dropboxBusy ? "Importing…" : "Add from Dropbox"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {OFFER_IMAGE_SLOTS.map((slot) => {
          const image = images[slot.key];
          const url = image?.url;
          const isAi = image?.source === "ai";
          const busy = uploading[slot.key] ?? false;
          const aiPending = aiBusy[slot.key] ?? false;
          return (
            <div
              key={slot.key}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-dashed border-royal-gold/50 bg-royal-gold-light/20">
                {url ? (
                  <Image
                    alt={slot.caption}
                    className="object-cover"
                    fill
                    sizes="200px"
                    src={url}
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs text-muted-foreground">
                    {busy ? "Uploading…" : aiPending ? "Generating…" : "No image yet"}
                  </span>
                )}
                {isAi ? (
                  <span className="absolute left-1 top-1 rounded bg-sidebar/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
                    AI concept
                  </span>
                ) : null}
              </div>
              <p className="text-xs font-semibold text-foreground">
                {slot.label}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-md bg-royal-gold-ink px-2.5 py-1 text-xs font-semibold text-white hover:bg-royal-gold-ink-hover">
                  {url ? "Replace" : "Upload"}
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleFile(slot.key, file);
                      }
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
                <button
                  className="rounded-md border border-royal-gold px-2 py-1 text-xs font-medium text-royal-gold-dark hover:bg-royal-gold-light/40 disabled:opacity-50"
                  disabled={aiPending}
                  onClick={() => void handleGenerate(slot.key)}
                  type="button"
                  title="Generate an AI concept image (indicative only)"
                >
                  {aiPending ? "…" : "AI"}
                </button>
                {url ? (
                  <button
                    className="text-xs font-medium text-muted-foreground hover:text-destructive"
                    onClick={() => onImageChange(slot.key, null)}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
