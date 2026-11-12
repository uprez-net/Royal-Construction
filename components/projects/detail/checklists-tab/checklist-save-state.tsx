"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";

// The inspection screen's autosave state: how many saves are in flight, when
// the last one landed, and whether one failed. Every write on the screen goes
// through `track`, so "All changes saved" is never shown over a lost change.

export type SaveState = {
  pending: number;
  savedAt: Date | null;
  failed: boolean;
};

export type TrackSave = <T>(work: () => Promise<T>) => Promise<T>;

export function useSaveTracker(): { save: SaveState; track: TrackSave } {
  const [save, setSave] = useState<SaveState>({
    failed: false,
    pending: 0,
    savedAt: null,
  });
  const track: TrackSave = async (work) => {
    setSave((current) => ({
      ...current,
      failed: false,
      pending: current.pending + 1,
    }));
    try {
      const result = await work();
      setSave((current) => ({
        ...current,
        pending: current.pending - 1,
        savedAt: new Date(),
      }));
      return result;
    } catch (error) {
      setSave((current) => ({
        ...current,
        failed: true,
        pending: current.pending - 1,
      }));
      throw error;
    }
  };
  return { save, track };
}

export function SaveIndicator({
  save,
  readOnly,
}: {
  save: SaveState;
  readOnly: boolean;
}) {
  if (readOnly) return null;
  return (
    <span
      className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {save.pending > 0 ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : save.failed ? (
        <span className="font-semibold text-destructive-ink">
          A change did not save
        </span>
      ) : save.savedAt ? (
        <>
          <CheckCircle2
            className="size-3.5 text-success-ink"
            aria-hidden="true"
          />
          All changes saved
        </>
      ) : (
        "Changes save automatically"
      )}
    </span>
  );
}
