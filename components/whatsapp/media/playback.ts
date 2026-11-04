"use client";

import { useEffect, useState } from "react";

import { peaksFromSamples, placeholderPeaks } from "@/lib/whatsapp/chat-format";

// Shared by the voice-note and video players.

let playing: HTMLMediaElement | null = null;

/**
 * One clip at a time, as WhatsApp does: starting a voice note or a video
 * pauses whatever else in the thread was playing.
 */
export function claimPlayback(element: HTMLMediaElement) {
  if (playing && playing !== element && !playing.paused) playing.pause();
  playing = element;
}

/** Above this the file is not fetched just to draw bars. */
const MAX_DECODE_BYTES = 6 * 1024 * 1024;

const cache = new Map<string, Promise<number[] | null>>();

async function decodePeaks(
  url: string,
  bars: number,
): Promise<number[] | null> {
  const AudioContextCtor =
    typeof window === "undefined"
      ? null
      : (window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
        ?? null);
  if (!AudioContextCtor) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.arrayBuffer();
  const context = new AudioContextCtor();
  try {
    const audio = await context.decodeAudioData(data);
    return peaksFromSamples(audio.getChannelData(0), bars);
  } finally {
    void context.close().catch(() => undefined);
  }
}

/**
 * The bars for one recording: decoded from the file once it scrolls into
 * view (cached per URL, so a poll re-rendering the thread costs nothing), or
 * a stable stand-in while that happens and when the browser can't decode it.
 */
export function useWaveform(
  url: string,
  seed: string,
  bars: number,
  byteSize: number | null,
  target: React.RefObject<HTMLElement | null>,
): { peaks: number[]; decoded: boolean } {
  const [decoded, setDecoded] = useState<number[] | null>(null);

  useEffect(() => {
    if (byteSize !== null && byteSize > MAX_DECODE_BYTES) return;
    const element = target.current;
    if (!element) return;
    let cancelled = false;
    const load = () => {
      const key = `${url}#${bars}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = decodePeaks(url, bars).catch(() => null);
        cache.set(key, pending);
      }
      void pending.then((peaks) => {
        if (!cancelled && peaks) setDecoded(peaks);
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [bars, byteSize, target, url]);

  return decoded
    ? { decoded: true, peaks: decoded }
    : { decoded: false, peaks: placeholderPeaks(seed, bars) };
}
