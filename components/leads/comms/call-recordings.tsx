"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { recordingUrl, retryRecording } from "@/lib/leads/comms-service";
import type { CallDto } from "@/lib/leads/comms-types";

import { CallTranscript } from "./call-transcript";

const TRANSCRIPT_NOTE: Partial<
  Record<CallDto["recordings"][number]["transcriptStatus"], string>
> = {
  EMPTY: "No speech in this recording.",
  FAILED: "Couldn't be transcribed.",
  PENDING: "Transcribing…",
  SKIPPED: "Too long to transcribe.",
};

/**
 * A call's transcripts and recordings: Mili's live transcript first, then each
 * stored recording or voicemail with its player and its speech-to-text.
 * Shared by a lead's Calls tab and the Pending Calls/Messages window.
 */
export function CallRecordings({
  call,
  onRetried,
  openTranscripts = false,
}: {
  call: CallDto;
  onRetried?: () => void;
  /** Unfolded, where reading the transcript is the point (the pending list). */
  openTranscripts?: boolean;
}) {
  return (
    <>
      <CallTranscript
        transcript={call.agentTranscript}
        label="Mili's transcript"
        defaultOpen={openTranscripts}
      />
      {call.recordings.map((recording) => {
        const label =
          recording.kind === "VOICEMAIL" ? "Voicemail" : "Recording";
        const note = recording.available
          ? TRANSCRIPT_NOTE[recording.transcriptStatus]
          : undefined;
        return (
          <div key={recording.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{label}</span>
              {recording.available ? (
                <audio
                  controls
                  preload="none"
                  src={recordingUrl(recording.id)}
                  className="h-8 max-w-full flex-1"
                />
              ) : recording.status === "FAILED" ? (
                <>
                  <span className="text-destructive">
                    {recording.failureReason ?? "Couldn't be saved."}
                  </span>
                  {onRetried ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        void retryRecording(recording.id).then(
                          () => {
                            toast.success("Trying the recording again.");
                            onRetried();
                          },
                          (error: unknown) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Couldn't retry.",
                            ),
                        )
                      }
                    >
                      Retry
                    </Button>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">Saving…</span>
              )}
            </div>
            {recording.transcript ? (
              <CallTranscript
                transcript={recording.transcript}
                label={`${label} transcript`}
                speakers={false}
                defaultOpen={
                  openTranscripts
                  && (recording.kind === "VOICEMAIL" || !call.agentTranscript)
                }
              />
            ) : note ? (
              <p className="text-xs text-muted-foreground">
                {label} transcript: {note}
              </p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
