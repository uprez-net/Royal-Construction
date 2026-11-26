import { readFile } from "node:fs/promises";
import path from "node:path";

import { reportError } from "@/lib/observability/report-error";

// The music an owner hears while holding for Hermes's answer on a briefing
// call (session.ts plays it; caller.ts decides when).
//
// 30 seconds of James Scott's "Don't Jazz Me Rag" (1921), from a public-domain
// piano recording on Wikimedia Commons; Scott died in 1938, so the piece is
// out of copyright in Australia as well. Converted once, with ffmpeg, to what
// the phone line plays, so nothing is decoded on a call:
//
//   ffmpeg -i rag.ogg -af "silenceremove=start_periods=1:start_threshold=-45dB,
//     atrim=0:30,highpass=f=250,lowpass=f=3400,loudnorm=I=-24:TP=-3:LRA=11,
//     afade=t=in:d=1,afade=t=out:st=28:d=2" -ac 1 -ar 8000 -f mulaw
//     assets/voice-agent/hold-music.ulaw
//
// It ships with the voice-agent route through outputFileTracingIncludes in
// next.config.ts. If it cannot be read the owner holds in silence, and that
// is reported: Mili still works, but someone should know why it went quiet.

export const HOLD_MUSIC_FILE = "assets/voice-agent/hold-music.ulaw";

/** A loader with its own cache: read once, and again only after a failure. */
export function holdMusicLoader(
  read: (file: string) => Promise<Uint8Array>,
): () => Promise<Uint8Array | null> {
  let cached: Promise<Uint8Array | null> | null = null;
  return () => {
    cached ??= read(path.join(process.cwd(), HOLD_MUSIC_FILE)).then(
      (audio) => (audio.length > 0 ? new Uint8Array(audio) : null),
      (error: unknown) => {
        reportError(error, { source: "voice-agent:hold-music" });
        // Tried again on the next call rather than cached as missing for good.
        cached = null;
        return null;
      },
    );
    return cached;
  };
}

export const loadHoldMusic = holdMusicLoader(readFile);
