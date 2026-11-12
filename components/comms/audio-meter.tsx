"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// A live level meter for one side of a call: bars that move with the voice,
// so the person on the phone can see their microphone is being heard and that
// the other side is coming through.
//
// The stream is asked for through a getter, re-checked every half second,
// because the SDKs only hand one over once the media is up — and may swap it.
// Each frame writes straight to the bars; nothing re-renders while it runs.

const BARS = 14;
const RECHECK_MS = 500;
// Bins of a 256-point FFT at 48 kHz are ~190 Hz wide: bins 1–21 cover the
// speech band (roughly 190 Hz – 4 kHz), spread over the bars.
const FIRST_BIN = 1;
const LAST_BIN = 21;
// The meter's floor, so a silent line still shows as a row of dots.
const MIN_SCALE = 0.12;

type AudioContextConstructor = typeof AudioContext;

function audioContextClass(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext
    ?? null
  );
}

export function AudioMeter({
  label,
  stream,
  muted = false,
  tone = "primary",
  className,
}: {
  label: string;
  /** The stream to measure; null until one exists. */
  stream: () => MediaStream | null;
  muted?: boolean;
  tone?: "primary" | "emerald";
  className?: string;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const getStream = useRef(stream);
  useEffect(() => {
    getStream.current = stream;
  }, [stream]);
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const found = audioContextClass();
    if (!found) return;
    const AudioContextClass: AudioContextConstructor = found;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let attached: MediaStream | null = null;
    let frame = 0;
    const data = new Uint8Array(128);

    function attach(next: MediaStream) {
      source?.disconnect();
      attached = next;
      try {
        context ??= new AudioContextClass();
        if (context.state === "suspended") void context.resume();
        analyser ??= context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        source = context.createMediaStreamSource(next);
        // Measured only: never connected to the speakers, so nothing echoes.
        source.connect(analyser);
      } catch {
        source = null;
      }
    }

    function check() {
      const next = getStream.current();
      if (next && next !== attached && next.getAudioTracks().length > 0) {
        attach(next);
      }
    }

    function draw() {
      const live = analyser && source && !mutedRef.current;
      if (live) analyser!.getByteFrequencyData(data);
      for (let index = 0; index < BARS; index += 1) {
        const bar = bars.current[index];
        if (!bar) continue;
        let level = 0;
        if (live) {
          const bin = Math.round(
            FIRST_BIN + (index / (BARS - 1)) * (LAST_BIN - FIRST_BIN),
          );
          level = data[bin] / 255;
        }
        const scale = MIN_SCALE + (1 - MIN_SCALE) * Math.min(1, level * 1.4);
        bar.style.transform = `scaleY(${scale.toFixed(3)})`;
      }
      frame = window.requestAnimationFrame(draw);
    }

    check();
    const timer = window.setInterval(check, RECHECK_MS);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.clearInterval(timer);
      window.cancelAnimationFrame(frame);
      source?.disconnect();
      void context?.close().catch(() => {});
    };
  }, []);

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="w-14 shrink-0 truncate text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <span
        className="flex h-6 flex-1 items-center justify-between gap-[3px]"
        aria-hidden="true"
      >
        {Array.from({ length: BARS }, (_, index) => (
          <span
            key={index}
            ref={(element) => {
              bars.current[index] = element;
            }}
            className={cn(
              "h-full w-full max-w-1 origin-center rounded-full transition-transform duration-75",
              muted
                ? "bg-muted-foreground/30"
                : tone === "emerald"
                  ? "bg-emerald-500"
                  : "bg-primary",
            )}
            style={{ transform: `scaleY(${MIN_SCALE})` }}
          />
        ))}
      </span>
      {muted ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          Muted
        </span>
      ) : null}
    </div>
  );
}
