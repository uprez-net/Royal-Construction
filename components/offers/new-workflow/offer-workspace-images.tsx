"use client";

import { upload } from "@vercel/blob/client";
import Image from "next/image";
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { buildBlobPath } from "@/utils/formatters";
import type { ClientPayload } from "@/utils/validators/files";
import {
  OFFER_IMAGE_SLOTS,
  type OfferImageMap,
  type OfferImageSlotKey,
} from "@/lib/offer/workspace-images";

type OfferWorkspaceImagesProps = {
  readonly images: OfferImageMap;
  readonly onImageChange: (key: OfferImageSlotKey, url: string | null) => void;
  readonly leadId?: number;
};

export function OfferWorkspaceImages({
  images,
  onImageChange,
  leadId,
}: OfferWorkspaceImagesProps) {
  const [uploading, setUploading] = useState<
    Partial<Record<OfferImageSlotKey, boolean>>
  >({});
  const [error, setError] = useState<string | null>(null);

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
      onImageChange(key, result.url);
    } catch (uploadError) {
      setError((uploadError as Error).message || "Upload failed");
    } finally {
      setUploading((current) => ({ ...current, [key]: false }));
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-heading text-lg font-semibold text-foreground">
          Proposal photos
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Attach the hero image, architect render and finished-home gallery.
          Each appears on the generated proposal; empty slots show a placeholder.
        </p>
      </div>
      {error ? (
        <p className="text-sm font-medium text-destructive">{error}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {OFFER_IMAGE_SLOTS.map((slot) => {
          const url = images[slot.key];
          const busy = uploading[slot.key] ?? false;
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
                  <span className="absolute inset-0 flex items-center justify-center px-2 text-center font-mono text-[10px] uppercase tracking-wide text-royal-gold-dark">
                    {busy ? "Uploading…" : "No image"}
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-foreground">
                {slot.label}
              </p>
              <div className="mt-auto flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center rounded-md bg-royal-gold px-2.5 py-1 text-xs font-semibold text-white hover:bg-royal-gold-dark">
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
