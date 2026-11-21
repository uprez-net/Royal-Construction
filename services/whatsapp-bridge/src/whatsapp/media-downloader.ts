import type { Logger } from "pino";

import type { BridgeMedia } from "../events/types.js";
import type { MediaStore } from "../store/media.js";
import type { NormalisedContent } from "./normalise.js";

// Downloading a group's file and saving it for the app, apart from the
// WhatsApp socket so it can be tested on its own.
//
// Memory is the constraint: each file is held whole until it is written. So
// at most `maxConcurrent` run at once — a slot is held from the first byte to
// the end of the save — and each stream is stopped the moment it passes the
// size limit.

export type MediaInfo = Extract<NormalisedContent, { kind: "media" }>["media"];

/** Opens the decrypted file as a stream; Baileys' downloadMediaMessage. */
export type OpenMediaStream = () => Promise<
  AsyncIterable<Buffer> & { destroy?: (error?: Error) => void }
>;

export class MediaDownloader {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly options: {
      readonly media: MediaStore;
      readonly maxBytes: number;
      readonly maxConcurrent: number;
      readonly logger: Logger;
    },
  ) {}

  private async withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }

  /** Download and save one file; always answers, saying why when it could not. */
  async fetch(
    messageId: string,
    info: MediaInfo,
    open: OpenMediaStream,
  ): Promise<BridgeMedia> {
    const { maxBytes } = this.options;
    const base = { ...info, available: false, unavailableReason: null };
    const tooLarge = `The file is larger than the bridge keeps (${Math.round(maxBytes / 1024 / 1024)} MB).`;
    if (info.byteSize !== null && info.byteSize > maxBytes) {
      return { ...base, unavailableReason: tooLarge };
    }
    try {
      return await this.withSlot(async () => {
        const stream = await open();
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of stream) {
          total += chunk.length;
          if (total > maxBytes) {
            stream.destroy?.();
            return { ...base, unavailableReason: tooLarge };
          }
          chunks.push(chunk);
        }
        // Saved inside the slot: the buffer is released only once written.
        const stored = await this.options.media.save(
          messageId,
          Buffer.concat(chunks),
          { fileName: info.fileName, mimeType: info.mimeType },
        );
        return {
          ...base,
          available: true,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
        };
      });
    } catch (error) {
      this.options.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          messageId,
        },
        "media download failed",
      );
      return {
        ...base,
        unavailableReason: "WhatsApp didn't let the bridge download the file.",
      };
    }
  }
}
