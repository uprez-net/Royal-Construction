"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMediaDuration } from "@/lib/whatsapp/chat-format";

import { claimPlayback } from "./playback";

const HIDE_CONTROLS_MS = 2500;

/**
 * A video inside a bubble. Before it plays: the first frame, a round play
 * button and the length, like WhatsApp. Playing: a slim control bar — play,
 * scrubber, time, mute, download, full screen — that fades out while the
 * pointer is still and comes back on any movement, tap or key.
 */
export function WhatsAppVideoPlayer({
  src,
  caption,
}: {
  src: string;
  caption: string | null;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  function wake() {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (video.current && !video.current.paused) setControlsVisible(false);
    }, HIDE_CONTROLS_MS);
  }

  function toggle() {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      claimPlayback(element);
      setStarted(true);
      setEnded(false);
      void element.play().catch(() => setFailed(true));
    } else {
      element.pause();
    }
    wake();
  }

  function toggleFullscreen() {
    const element = frame.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.().catch(() => undefined);
  }

  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        download
        className="flex min-w-60 items-center gap-2.5 rounded-md bg-black/4 px-3 py-2.5 text-[13px] text-foreground hover:bg-black/7"
      >
        <Download className="size-4 shrink-0" aria-hidden="true" />
        This browser can&apos;t play the video — download it instead.
      </a>
    );
  }

  const showChrome = !playing || controlsVisible;

  return (
    <div
      ref={frame}
      tabIndex={0}
      role="group"
      aria-label={caption ? `Video player: ${caption}` : "Video player"}
      onPointerMove={wake}
      onKeyDown={(event) => {
        // Shortcuts only when the player itself has focus: Space on a focused
        // control already clicks it, and must not toggle playback twice.
        if (event.target !== event.currentTarget) return;
        if (event.key === " " || event.key === "k") {
          event.preventDefault();
          toggle();
        } else if (event.key === "f") {
          toggleFullscreen();
        } else if (event.key === "m" && video.current) {
          video.current.muted = !video.current.muted;
        }
      }}
      className={cn(
        "group/video relative overflow-hidden bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-gold-ink",
        fullscreen
          ? "flex size-full items-center justify-center"
          : "w-full min-w-55 max-w-82.5 rounded-md",
      )}
    >
      <video
        ref={video}
        // `#t=0.1` asks Safari to paint the first frame as the poster.
        src={`${src}#t=0.1`}
        preload="metadata"
        playsInline
        aria-label={caption ? `Video: ${caption}` : "Video"}
        onClick={toggle}
        className={cn(
          "block w-full cursor-pointer object-contain",
          fullscreen ? "max-h-screen" : "max-h-82.5 min-h-40",
        )}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setDuration(value);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => {
          setPlaying(true);
          wake();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
          setControlsVisible(true);
        }}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onError={() => setFailed(true)}
      />

      {/* Centre button: play before it starts, replay at the end. */}
      {!playing ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={ended ? "Replay video" : "Play video"}
          className="absolute left-1/2 top-1/2 inline-flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white"
        >
          {ended ? (
            <RotateCcw className="size-6" aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 size-6 fill-current" aria-hidden="true" />
          )}
        </button>
      ) : buffering ? (
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white">
          <Loader2 className="size-8 animate-spin" aria-hidden="true" />
        </span>
      ) : null}

      {!started ? (
        <span className="pointer-events-none absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[11px] font-medium text-white drop-shadow">
          <Video className="size-3.5" aria-hidden="true" />
          {duration ? formatMediaDuration(duration) : null}
        </span>
      ) : (
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-2.5 pb-1.5 pt-2 text-white transition-opacity duration-200",
            showChrome ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
          >
            {playing ? (
              <Pause className="size-4 fill-current" aria-hidden="true" />
            ) : (
              <Play className="size-4 fill-current" aria-hidden="true" />
            )}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums">
            {formatMediaDuration(current)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            aria-label="Seek"
            aria-valuetext={`${formatMediaDuration(current)} of ${formatMediaDuration(duration)}`}
            onChange={(event) => {
              const time = Number(event.target.value);
              if (video.current) video.current.currentTime = time;
              setCurrent(time);
              wake();
            }}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-success-ink"
          />
          <span className="shrink-0 text-[11px] tabular-nums text-white/80">
            {formatMediaDuration(duration)}
          </span>
          <button
            type="button"
            onClick={() => {
              if (video.current) video.current.muted = !video.current.muted;
            }}
            aria-label={muted ? "Unmute" : "Mute"}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
          >
            {muted ? (
              <VolumeX className="size-4" aria-hidden="true" />
            ) : (
              <Volume2 className="size-4" aria-hidden="true" />
            )}
          </button>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            download
            aria-label="Download video"
            className="hidden size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/15 sm:inline-flex"
          >
            <Download className="size-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
          >
            {fullscreen ? (
              <Minimize className="size-4" aria-hidden="true" />
            ) : (
              <Maximize className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
