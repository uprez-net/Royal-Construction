"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppDispatch } from "@/lib/store/hooks";
import { sendSignedCopies } from "@/lib/store/slices/projectsSlice";

type CertifierSendSignedCopiesModalProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Sends the countersigned fee proposal and CDC form.
 *
 * Opened by the upload that completes the pair rather than by a button: the
 * certifier will not issue a checklist until they have both signatures, and
 * nothing in the flow would prompt an admin to send them. This is the step
 * that used to be missing entirely — the files were collected, the Get
 * Checklist gate opened, and the certifier never received anything.
 *
 * The send is idempotent server-side through a status-guarded transition, so a
 * second mount cannot produce a second email.
 */
export function CertifierSendSignedCopiesModal({
  projectId,
  open,
  onOpenChange,
}: CertifierSendSignedCopiesModalProps) {
  const dispatch = useAppDispatch();
  const [state, setState] = useState<"sending" | "sent" | "failed">("sending");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open || startedRef.current) {
      return;
    }
    startedRef.current = true;

    void (async () => {
      try {
        await dispatch(sendSignedCopies({ projectId })).unwrap();
        setState("sent");
      } catch (sendError) {
        setError(
          typeof sendError === "string"
            ? sendError
            : sendError instanceof Error
              ? sendError.message
              : "The signed copies could not be sent.",
        );
        setState("failed");
      }
    })();
  }, [open, projectId, dispatch]);

  const retry = () => {
    startedRef.current = false;
    setError(null);
    setState("sending");
    void (async () => {
      startedRef.current = true;
      try {
        await dispatch(sendSignedCopies({ projectId })).unwrap();
        setState("sent");
      } catch (sendError) {
        setError(
          typeof sendError === "string"
            ? sendError
            : sendError instanceof Error
              ? sendError.message
              : "The signed copies could not be sent.",
        );
        setState("failed");
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state === "sending"
              ? "Sending signed copies to certifier…"
              : state === "sent"
                ? "Signed copies sent"
                : "Could not send the signed copies"}
          </DialogTitle>
          <DialogDescription>
            {state === "sent"
              ? "The certifier has the signed fee proposal and CDC form. You can ask for the checklist now."
              : "The signed fee proposal and CDC application form go back on the same email thread."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 py-2">
          {state === "sending" ? (
            <Loader2
              className="size-5 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : state === "sent" ? (
            <CheckCircle2
              className="size-5 text-success-ink"
              aria-hidden="true"
            />
          ) : (
            <AlertCircle
              className="size-5 text-destructive-ink"
              aria-hidden="true"
            />
          )}
          <p className="text-sm text-muted-foreground">
            {state === "sending"
              ? "Attaching both documents and replying on the thread…"
              : state === "sent"
                ? "Get Checklist is now available."
                : error}
          </p>
        </div>

        <DialogFooter>
          {state === "failed" ? (
            <Button type="button" variant="outline" onClick={retry}>
              Try again
            </Button>
          ) : null}
          <Button
            type="button"
            variant={state === "sending" ? "outline" : "default"}
            disabled={state === "sending"}
            onClick={() => onOpenChange(false)}
          >
            {state === "failed" ? "Close" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
