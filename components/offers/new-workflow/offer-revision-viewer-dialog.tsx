"use client";

import { useEffect, useState, type RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  loadOfferRevisionSnapshot,
  type LoadedOfferRevision,
} from "@/lib/data/offer-workspace";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import {
  OFFER_STATUS_LABEL,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import { Loader2 } from "lucide-react";
import { OfferWorkspacePrintTemplate } from "./offer-workspace-print-template";

type ViewerState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "loaded"; revision: LoadedOfferRevision };

// Read-only view of one offer revision, rendered from that revision's saved
// workspace snapshot. Deliberately renders ONLY the proposal document — it must
// never mount the editable workspace, because doing so would put a superseded
// offerId into the autosave/send/transition paths and let a viewer rewrite
// history. The server refuses those writes too (authorizeOfferAccess), but the
// UI should not be asking in the first place.
export function OfferRevisionViewerDialog({
  offerId,
  onClose,
  restoreFocusRef,
}: {
  // Non-null means "open, showing this revision"; null means closed.
  readonly offerId: string | null;
  readonly onClose: () => void;
  // Where to put focus on close. Radix restores to the dialog's trigger, but
  // this dialog is opened from a row inside a popover that unmounts on select,
  // so without this focus would land on <body>.
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog
      open={offerId !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      {/* Overrides the base grid/gap-4 so the body can own the single scroll
          area, and caps the height so a multi-page A4 document stays reachable
          (the base DialogContent sets no max-height). print:hidden keeps this
          copy out of the way if the user prints while it is open. */}
      <DialogContent
        className="flex max-h-[90vh] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[860px] print:hidden"
        onCloseAutoFocus={(event) => {
          if (restoreFocusRef?.current) {
            event.preventDefault();
            restoreFocusRef.current.focus();
          }
        }}
      >
        {/* Keyed on offerId so picking a different version remounts with a
            fresh loading state, rather than resetting state from inside an
            effect (which would cascade an extra render). */}
        {offerId === null ? (
          <ViewerHeader title="Version" />
        ) : (
          <RevisionContent key={offerId} offerId={offerId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevisionContent({ offerId }: { readonly offerId: string }) {
  const [state, setState] = useState<ViewerState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const revision = await loadOfferRevisionSnapshot(offerId);
        if (!cancelled) {
          setState({ kind: "loaded", revision });
        }
      } catch {
        if (!cancelled) {
          setState({ kind: "failed", message: "Couldn't open this version." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  return <ViewerBody state={state} />;
}

function ViewerBody({ state }: { readonly state: ViewerState }) {
  if (state.kind === "loading") {
    return (
      <>
        <ViewerHeader title="Loading version…" />
        <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      </>
    );
  }

  if (state.kind === "failed") {
    return (
      <>
        <ViewerHeader title="Version" />
        <p className="px-4 py-10 text-sm text-destructive">{state.message}</p>
      </>
    );
  }

  const { revision } = state;

  if (!revision.ok) {
    return (
      <>
        <ViewerHeader title="Version" />
        <p className="px-4 py-10 text-sm text-muted-foreground">
          {revision.reason === "empty"
            ? "This version was replaced before any details were saved onto it, so there is nothing to show."
            : "This version's saved details can't be read — the format has changed since it was stored."}
        </p>
      </>
    );
  }

  const input = buildProposalInput(revision.snapshot);
  const statusLabel =
    OFFER_STATUS_LABEL[
      revision.status.toLowerCase() as OfferWorkspaceStatus
    ] ?? revision.status;

  return (
    <>
      <ViewerHeader
        title={revision.reference}
        statusLabel={statusLabel}
        isActive={revision.isActive}
      />
      {/* The single scroll container. Scrolls on BOTH axes: a print page is a
          fixed 210mm (~794px) wide and will not reflow on a narrow screen. */}
      <div className="flex-1 overflow-auto bg-muted/40 p-4">
        <OfferWorkspacePrintTemplate
          {...input}
          // buildProposalInput does not carry images; without this the cover
          // photo and the whole gallery page render blank.
          images={revision.snapshot.images}
          // Stamp the date this revision was drawn up, not today.
          preparedDate={new Date(revision.createdAt)}
          screen
        />
      </div>
    </>
  );
}

function ViewerHeader({
  title,
  statusLabel,
  isActive,
}: {
  readonly title: string;
  readonly statusLabel?: string;
  readonly isActive?: boolean;
}) {
  return (
    <DialogHeader className="shrink-0 gap-1 border-b border-border/70 px-4 py-3 pr-12">
      <div className="flex flex-wrap items-center gap-2">
        <DialogTitle className="font-mono text-sm">{title}</DialogTitle>
        {statusLabel ? (
          <Badge variant="secondary">{statusLabel}</Badge>
        ) : null}
        {isActive === false ? (
          <Badge variant="secondary">Read-only</Badge>
        ) : null}
      </div>
      <DialogDescription>
        {isActive === false
          ? "A previous version of this offer. Standard inclusions and company details show their current wording."
          : "Viewing this offer as it stands."}
      </DialogDescription>
    </DialogHeader>
  );
}
