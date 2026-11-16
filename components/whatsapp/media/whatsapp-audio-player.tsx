"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Headphones, Loader2, Mic, Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMediaDuration } from "@/lib/whatsapp/chat-format";

import { claimPlayback, useWaveform } from "./playback";

const BARS = 36;
const SPEEDS = [1, 1.5, 2] as const;
const SEEK_STEP_SECONDS = 5;

/**
 * A voice note (or an audio file) as WhatsApp draws one: a round play button,
 * the recording's waveform filling in green as it plays — click or drag it to
 * seek, arrow keys too — the time, and a 1× / 1.5× / 2× speed toggle.
 */
export function WhatsAppAudioPlayer({
  src,
  seed,
  voice,
  byteSize,
}: {
  src: string;
  /** Stable per file, for the stand-in waveform. */
  seed: string;
  voice: boolean;
  byteSize: number | null;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const { peaks } = useWaveform(src, seed, BARS, byteSize, track);

  // Smooth progress while playing; `timeupdate` alone ticks about 4× a second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audio.current) setCurrent(audio.current.currentTime);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing]);

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      claimPlayback(element);
      setLoading(true);
      void element.play().catch(() => {
        setLoading(false);
        setFailed(true);
      });
    } else {
      element.pause();
    }
  }

  function seekTo(ratio: number) {
    const element = audio.current;
    if (!element || !duration) return;
    const time = Math.max(0, Math.min(duration, ratio * duration));
    element.currentTime = time;
    setCurrent(time);
  }

  function seekFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - box.left) / box.width);
  }

  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        download
        className="flex min-w-60 items-center gap-2.5 rounded-md bg-black/4 px-3 py-2.5 text-[13px] text-muted-foreground hover:bg-black/7"
      >
        <Download className="size-4 shrink-0" aria-hidden="true" />
        This browser can&apos;t play the {voice ? "voice message" : "audio"} —
        download it instead.
      </a>
    );
  }

  return (
    <div className="flex w-70 max-w-full items-center gap-2.5 py-1 pl-0.5 pr-1">
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white",
          voice ? "bg-royal-gold-ink" : "bg-warning",
        )}
      >
        {voice ? <Mic className="size-5" /> : <Headphones className="size-5" />}
      </span>

      <button
        type="button"
        onClick={toggle}
        aria-label={
          playing ? "Pause" : voice ? "Play voice message" : "Play audio"
        }
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-royal-gold-ink"
      >
        {loading ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : playing ? (
          <Pause className="size-5 fill-current" aria-hidden="true" />
        ) : (
          <Play className="size-5 fill-current" aria-hidden="true" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatMediaDuration(current)} of ${formatMediaDuration(duration)}`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              seekFromPointer(event);
            }
          }}
          onKeyDown={(event) => {
            if (!duration) return;
            const step = SEEK_STEP_SECONDS / duration;
            if (event.key === "ArrowRight") seekTo(progress + step);
            else if (event.key === "ArrowLeft") seekTo(progress - step);
            else if (event.key === "Home") seekTo(0);
            else if (event.key === "End") seekTo(1);
            else return;
            event.preventDefault();
          }}
          className="relative flex h-8 cursor-pointer touch-none items-center gap-[2px] rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-gold-ink"
        >
          {peaks.map((peak, index) => {
            const played = (index + 0.5) / peaks.length <= progress;
            return (
              <span
                key={index}
                aria-hidden="true"
                className={cn(
                  "min-w-0 flex-1 rounded-full transition-colors duration-150",
                  played ? "bg-royal-gold-ink" : "bg-muted-foreground/45",
                )}
                style={{ height: `${Math.round(peak * 100)}%` }}
              />
            );
          })}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-royal-gold-ink shadow-sm"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>
            {formatMediaDuration(playing || current > 0 ? current : duration)}
          </span>
          {voice ? (
            <button
              type="button"
              onClick={() => {
                const next =
                  SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                setSpeed(next);
                if (audio.current) audio.current.playbackRate = next;
              }}
              aria-label={`Playback speed ${speed}×`}
              className="rounded-full bg-black/6 px-1.5 py-px text-[11px] font-semibold text-muted-foreground hover:bg-black/10"
            >
              {speed}×
            </button>
          ) : null}
        </div>
      </div>

      <audio
        ref={audio}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setDuration(value);
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setDuration(value);
        }}
        onPlay={() => setPlaying(true)}
        onPlaying={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPause={() => {
          setPlaying(false);
          setLoading(false);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onEnded={(event) => {
          event.currentTarget.currentTime = 0;
          setCurrent(0);
          setPlaying(false);
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
