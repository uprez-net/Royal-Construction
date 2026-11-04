import { SYDNEY_TZ } from "@/lib/dates/sydney";

// Display rules for the WhatsApp-style chat view. Pure, so what an operator
// reads — "Yesterday", "2:05 pm", "1.2 MB" — can be tested without React.
// Every time is Sydney's, whatever zone the browser is in.

const TIME = new Intl.DateTimeFormat("en-AU", {
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  timeZone: SYDNEY_TZ,
});

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: SYDNEY_TZ,
  year: "numeric",
});

const WEEKDAY = new Intl.DateTimeFormat("en-AU", {
  timeZone: SYDNEY_TZ,
  weekday: "long",
});

const FULL_DATE = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  timeZone: SYDNEY_TZ,
  year: "numeric",
});

/** "2:05 pm" — the stamp inside a bubble. */
export function chatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : TIME.format(date).toLowerCase();
}

/** "2026-11-04" in Sydney — which day separator a message sits under. */
export function chatDayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DAY_KEY.format(date);
}

/** "Today", "Yesterday", "Monday" (this week) or "4 November 2026". */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const key = DAY_KEY.format(date);
  if (key === DAY_KEY.format(now)) return "Today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === DAY_KEY.format(yesterday)) return "Yesterday";
  const days = (Date.parse(DAY_KEY.format(now)) - Date.parse(key)) / 86_400_000;
  if (days > 0 && days < 7) return WEEKDAY.format(date);
  return FULL_DATE.format(date);
}

/** The name colours WhatsApp uses for people in a group, light theme. */
const SENDER_COLOURS = [
  "#1f7aec",
  "#d62976",
  "#00a884",
  "#e26a00",
  "#7f66ff",
  "#06cf9c",
  "#c45b0e",
  "#008069",
  "#a62c71",
  "#5e47de",
] as const;

/** One stable colour per participant, from their number. */
export function senderColour(key: string | null | undefined): string {
  if (!key) return SENDER_COLOURS[0];
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SENDER_COLOURS[hash % SENDER_COLOURS.length];
}

/** "840 KB", "1.2 MB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "PDF", "DOCX" — the badge on a document. */
export function fileKindLabel(
  fileName: string | null | undefined,
  mimeType: string | null | undefined,
): string {
  const ext = fileName?.match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  if (ext) return ext.toUpperCase();
  const sub = mimeType?.split("/")[1]?.split(/[;+.-]/)[0];
  return sub ? sub.toUpperCase().slice(0, 5) : "FILE";
}

/** Initials for an avatar: "Sam Lee" → "SL", "+61 412…" → "#". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "#";
  return (
    words[0][0] + (words.length > 1 ? words.at(-1)![0] : "")
  ).toUpperCase();
}

/** "0:07", "1:42", "1:02:05" — a media clock. Unknown or broken reads "0:00". */
export function formatMediaDuration(
  seconds: number | null | undefined,
): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The quietest bar still drawn, so silence reads as a line, not a gap. */
const MIN_PEAK = 0.08;

/**
 * A waveform for the voice-note player: `bars` heights between MIN_PEAK and
 * 1, from decoded samples. RMS per slice, normalised to the loudest slice, so
 * a quiet recording still fills the bubble.
 */
export function peaksFromSamples(
  samples: ArrayLike<number>,
  bars: number,
): number[] {
  if (bars <= 0) return [];
  if (samples.length === 0) return Array.from({ length: bars }, () => MIN_PEAK);
  const size = Math.max(1, Math.floor(samples.length / bars));
  const rms: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * size;
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      sum += samples[index] * samples[index];
    }
    rms.push(end > start ? Math.sqrt(sum / (end - start)) : 0);
  }
  const loudest = Math.max(...rms);
  if (loudest <= 0) return rms.map(() => MIN_PEAK);
  return rms.map((value) =>
    Number(Math.max(MIN_PEAK, value / loudest).toFixed(3)),
  );
}

/**
 * A stand-in waveform when the file can't be decoded in this browser (Safari
 * and some Ogg voice notes): stable for a file, so it doesn't jump on every
 * render, and clearly speech-shaped rather than a flat line.
 */
export function placeholderPeaks(seed: string, bars: number): number[] {
  let state = 2166136261;
  for (const char of seed)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return Array.from({ length: bars }, (_, index) => {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    const noise = (state % 1000) / 1000;
    const envelope = Math.sin((Math.PI * (index + 0.5)) / bars);
    return Number(
      Math.max(MIN_PEAK, 0.25 + 0.75 * noise * envelope).toFixed(3),
    );
  });
}
