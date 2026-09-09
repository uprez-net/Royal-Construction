"use client";

import { ComplianceExternalApplicationKind } from "@prisma/client";
import { ExternalLink, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EXTERNAL_APPLICATION_COPY } from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  recordExternalApplication,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";
import {
  externalApplicationStep,
  type ComplianceExternalApplicationRecord,
} from "@/types/compliance";
import { dateFormat } from "@/utils/formatters";
import type { ExternalApplicationRequest } from "@/utils/validators/compliance";

/**
 * Anything bought from an outside body, from "do we have one?" to the file.
 *
 * This block used to be a yes/no held in `useState` on the section around it,
 * for the 10.7 certificate alone. That was honest while the only two outcomes
 * were "upload it" and "go and buy one" — but buying one takes the NSW Planning
 * Portal three to five working days, and nothing recorded that an application
 * existed. So a job where somebody had lodged one on Monday looked exactly like
 * a job where nobody had done anything at all, the answer was forgotten the
 * moment the tab was left, and there was no date for anything to be late
 * against.
 *
 * Four more of exactly that shape arrived with the development application: a
 * road opening and vehicle crossing permit, a long service levy receipt, a mine
 * subsidence approval, and the DA itself. Rather than four more cards that
 * would each drift from this one, the block took a `kind` — everything that
 * differs between them is a row of `EXTERNAL_APPLICATION_COPY`, and the five
 * steps are the same five steps.
 *
 * Every answer here is persisted, which is what makes the daily sweep possible:
 * an application with a lodgement date is a clock, and a clock is the only
 * thing an alert can be raised off.
 *
 * The steps are derived from the row rather than held here — see
 * `externalApplicationStep`. The only local state is the two disclosures: a
 * form somebody has opened and not submitted, which is a fact about this render
 * and nothing else.
 */

/**
 * The controls on this block that write, named so a spinner can find its own.
 *
 * Four, and no two of them are ever on screen together — but which one is
 * showing depends on the step, and the block re-renders into a different step
 * the moment a save lands, so a single "busy" flag has no way of saying what it
 * was busy with.
 */
type PendingControl = "yes" | "no" | "applied" | "received";

type ExternalApplicationBlockProps = {
  projectId: string;
  kind: ComplianceExternalApplicationKind;
  application: ComplianceExternalApplicationRecord | null;
  /** The document's own row, rendered once it can be uploaded. */
  documentRows: ReactNode;
  /**
   * Where to go and get it, overriding the table.
   *
   * Only the road opening permit uses this, and it is why the table's `url` is
   * nullable: there is no NSW-wide road opening application, so the link is
   * resolved from the project's council by the caller.
   */
  portalUrl?: string | null;
  /**
   * Whether the reader can still change anything.
   *
   * The one case is the 10.7 certificate on a job that has moved to a
   * development application. The certificate is still wanted, but it is ordered
   * from the DA block now — so the copy on the pack goes read-only rather than
   * offering the same three controls in a second place, where the two would
   * then disagree about whether an application had been lodged.
   */
  readOnly?: boolean;
};

export function ExternalApplicationBlock({
  projectId,
  kind,
  application,
  documentRows,
  portalUrl,
  readOnly = false,
}: ExternalApplicationBlockProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.application(kind)),
  );
  const copy = EXTERNAL_APPLICATION_COPY[kind];
  const url = portalUrl ?? copy.url;
  const isBusy = mutation.status === "pending" || readOnly;

  /**
   * Whether the lodgement form is open.
   *
   * Local, and deliberately not a persisted "started filling this in" flag.
   * Ticking the box is not a fact about the job — lodging an application is,
   * and that is what the submit records. A tick that wrote to the server would
   * mean an admin who opened the form and thought better of it had told the
   * system an application existed.
   */
  const [isLodgementOpen, setIsLodgementOpen] = useState(false);

  /**
   * Which control is mid-request, rather than merely that one is.
   *
   * The store's scope tells us the block is busy; it cannot tell us which of
   * the four things on it was clicked. Reading only that put the spinner on
   * "Yes" whichever button was pressed — so answering "No" greyed both out and
   * animated the wrong one, which reads as the click having gone somewhere
   * unintended. The same gap left the two checkboxes with no feedback at all:
   * they disabled themselves and sat there unticked until the round trip came
   * back.
   *
   * Set before the dispatch and cleared in a `finally`, so a rejected save
   * releases the control rather than stranding the block on a spinner.
   */
  const [pending, setPending] = useState<PendingControl | null>(null);

  const step = externalApplicationStep(application);

  /** When it was lodged, formatted, or null. Read by the read-only branch and
   *  by the lodged step below, which is why it is derived once here. */
  const appliedAtLabel = application?.appliedAt
    ? dateFormat.format(new Date(application.appliedAt))
    : null;

  const save = async (
    control: PendingControl,
    payload: ExternalApplicationRequest,
    success: string,
  ) => {
    setPending(control);
    try {
      await dispatch(
        recordExternalApplication({ projectId, ...payload }),
      ).unwrap();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Could not save that against the ${copy.label.toLowerCase()}.`,
      );
      return false;
    } finally {
      setPending(null);
    }
  };

  // -----------------------------------------------------------------
  // Read-only — the block is somewhere else on this job.
  //
  // Ahead of the steps rather than folded into them, because a disabled
  // control is not the same thing as a control that belongs elsewhere. The one
  // case is the 10.7 certificate after a job moves to a development
  // application: the certificate is still needed, the DA block is where it is
  // now ordered, and two Yes/No buttons greyed out here with no explanation
  // read as a step that has broken rather than one that has moved.
  // -----------------------------------------------------------------
  if (readOnly) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Ordered from the development application below, so that the same
          certificate is not applied for in two places.
        </p>
        {step === "lodged" && appliedAtLabel ? (
          <p className="text-xs text-muted-foreground">
            Lodged {appliedAtLabel}
            {application?.applicationRef
              ? ` under ${application.applicationRef}`
              : ""}
            .
          </p>
        ) : null}
        {documentRows}
      </div>
    );
  }

  // -----------------------------------------------------------------
  // Step 1 — nobody has been asked yet.
  // -----------------------------------------------------------------
  if (step === "unanswered") {
    return (
      <>
        <p className="font-medium text-foreground">
          Do you already have the {copy.label.toLowerCase()}?
        </p>
        {/* Both disabled while either is in flight — this is one question with
            two answers, and a second click on the other one mid-save would
            write the opposite of what the first said. Only the one that was
            actually pressed spins. */}
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() =>
              void save(
                "yes",
                { step: "answer", kind, alreadyHeld: true },
                "Noted — upload it below.",
              )
            }
          >
            {pending === "yes" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Yes
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() =>
              void save(
                "no",
                { step: "answer", kind, alreadyHeld: false },
                `Noted — apply through ${copy.portal} when you can.`,
              )
            }
          >
            {pending === "no" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            No
          </Button>
        </div>
      </>
    );
  }

  // -----------------------------------------------------------------
  // Steps 2 and 5 — there is a document to put on the file.
  //
  // The same rendering for "we already had one" and "it came back", because
  // from here they are the same thing: a document to upload. What differs is
  // only what is said above the row.
  // -----------------------------------------------------------------
  if (step === "held" || step === "received") {
    return (
      <>
        {/* The caller renders the rows on their own once a file has landed, so
            this branch only ever runs while the row is still empty — which is
            why the line above it always asks for one. */}
        <p className="mb-2 text-sm text-muted-foreground">
          {step === "received"
            ? "Marked as received. Upload it to put it on the file."
            : "Upload the copy you are holding."}
        </p>
        {documentRows}
      </>
    );
  }

  // -----------------------------------------------------------------
  // Step 3 — it has to be ordered.
  // -----------------------------------------------------------------
  if (step === "to-order") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {copy.instruction}{" "}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              {copy.portal}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </p>

        {/* This one writes nothing on its own — it opens the form below, and
            the form's Save is what records the application. So there is no
            request for it to spin against; it stays ticked because the form it
            revealed is still on screen. It is disabled during a save so it
            cannot be untoggled out from under a submit that is in flight. */}
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Checkbox
            checked={isLodgementOpen}
            onCheckedChange={(checked) => setIsLodgementOpen(checked === true)}
            disabled={isBusy}
          />
          Applied for it
        </label>

        {isLodgementOpen ? (
          <LodgementForm
            kind={kind}
            isBusy={isBusy}
            isSaving={pending === "applied"}
            application={application}
            onSubmit={async (values) => {
              const saved = await save(
                "applied",
                { step: "applied", kind, ...values },
                "Application recorded — we will flag it if it takes too long.",
              );
              if (saved) setIsLodgementOpen(false);
            }}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Tick this once it is lodged. {copy.portal} usually answers within{" "}
            {copy.turnaround} — recording the date is what lets us tell you when
            it has not.
          </p>
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------
  // Step 4 — lodged, and waiting.
  // -----------------------------------------------------------------
  const appliedAt = application?.appliedAt
    ? new Date(application.appliedAt)
    : null;
  const elapsed = appliedAt ? businessDaysSince(appliedAt) : 0;
  const isOverdue = elapsed > copy.businessDays;

  return (
    <div className="space-y-3">
      <dl className="space-y-1 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm">
        <DetailRow label="Lodged" value={appliedAtLabel ?? "—"} />
        {application?.applicationRef ? (
          <DetailRow
            label="Application"
            value={application.applicationRef}
          />
        ) : null}
        {application?.lodgedWith ? (
          <DetailRow label="With" value={application.lodgedWith} />
        ) : null}
      </dl>

      {/* Working days, not calendar days, and said so. Somebody reading "6
          days" against a portal that quotes five would otherwise count on
          their fingers and get a different answer through a long weekend. */}
      <p
        className={
          isOverdue
            ? "text-xs text-warning-ink"
            : "text-xs text-muted-foreground"
        }
      >
        {elapsed === 0
          ? `Lodged today. ${copy.portal} usually answers within ${copy.turnaround}.`
          : isOverdue
            ? `${elapsed} working days with ${copy.portal} — past the ${copy.turnaround} it usually takes. Chase it using the application number above.`
            : `${elapsed} working day${elapsed === 1 ? "" : "s"} with ${copy.portal}, against ${copy.turnaround}.`}
      </p>

      {/* Ticked the moment it is clicked, and held ticked until the save comes
          back. A checkbox that springs back to unticked while its request is in
          flight reads as a click that missed — and this one is a round trip, so
          that gap is long enough to notice. The spinner beside the label is
          what says the tick has not landed yet; the block re-renders into the
          upload step when it has. */}
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Checkbox
          checked={pending === "received"}
          disabled={isBusy}
          onCheckedChange={(checked) => {
            if (checked !== true) return;
            void save(
              "received",
              { step: "received", kind, received: true },
              "Marked as received — upload it below.",
            );
          }}
        />
        Received it
        {pending === "received" ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </label>

      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        disabled={isBusy}
        onClick={() => setIsLodgementOpen((open) => !open)}
      >
        {isLodgementOpen ? "Cancel" : "Correct the application details"}
      </button>

      {isLodgementOpen ? (
        <LodgementForm
          kind={kind}
          isBusy={isBusy}
          isSaving={pending === "applied"}
          application={application}
          onSubmit={async (values) => {
            const saved = await save(
              "applied",
              { step: "applied", kind, ...values },
              "Application details updated.",
            );
            if (saved) setIsLodgementOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

/**
 * The three things worth knowing about a lodged application.
 *
 * Only the date is required, and that asymmetry is the point: the date is the
 * clock, and without it the step records nothing anybody can act on, while the
 * application number and the council are what somebody needs in order to chase
 * it — routinely not to hand at the moment the application goes in, and easy to
 * add later from the same form.
 */
function LodgementForm({
  kind,
  application,
  isBusy,
  isSaving,
  onSubmit,
}: {
  /**
   * Which application this form is for, used to key its field ids.
   *
   * Necessary rather than decorative: the development application list renders
   * three of these blocks at once, and three forms sharing `id="applied-at"`
   * means every label points at the first one. Clicking "Date submitted" on the
   * long service levy would focus the road opening permit's field.
   */
  kind: ComplianceExternalApplicationKind;
  application: ComplianceExternalApplicationRecord | null;
  /** Anything on the block is writing — every field is frozen. */
  isBusy: boolean;
  /**
   * This form in particular is writing.
   *
   * Separate from `isBusy` because the two are not the same while the form sits
   * open on the lodged step: ticking "Received it" makes
   * the block busy, and a Save button spinning underneath that would claim the
   * form had been submitted when it had not.
   */
  isSaving: boolean;
  onSubmit: (values: {
    appliedAt: string;
    applicationRef?: string;
    lodgedWith?: string;
  }) => void | Promise<void>;
}) {
  /** Today in the browser's own calendar, which is the one the picker shows. */
  const today = new Date();
  const asInputDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
      value.getDate(),
    ).padStart(2, "0")}`;

  const [appliedAt, setAppliedAt] = useState(
    application?.appliedAt
      ? asInputDate(new Date(application.appliedAt))
      : asInputDate(today),
  );
  const [applicationRef, setApplicationRef] = useState(
    application?.applicationRef ?? "",
  );
  const [lodgedWith, setLodgedWith] = useState(application?.lodgedWith ?? "");
  // The body this normally goes to, as a hint rather than a default. A
  // prefilled answer that is usually right and occasionally wrong is worse than
  // an empty one — see the column's own note in the schema.
  const copyPortal = EXTERNAL_APPLICATION_COPY[kind].portal;

  return (
    <form
      className="space-y-3 rounded-lg border border-border/70 bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!appliedAt) return;
        void onSubmit({
          // Midday rather than midnight. The value is a calendar date with no
          // time on it, and midnight is the one instant a timezone shift moves
          // onto the day before — which would make an application lodged today
          // read as lodged yesterday and start the clock a day early.
          appliedAt: new Date(`${appliedAt}T12:00:00`).toISOString(),
          applicationRef: applicationRef.trim() || undefined,
          lodgedWith: lodgedWith.trim() || undefined,
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-applied-at`}>Date submitted</Label>
        <Input
          id={`${kind}-applied-at`}
          type="date"
          value={appliedAt}
          max={asInputDate(today)}
          onChange={(event) => setAppliedAt(event.target.value)}
          disabled={isBusy}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-application-ref`}>
          Application number{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${kind}-application-ref`}
          value={applicationRef}
          onChange={(event) => setApplicationRef(event.target.value)}
          placeholder="From the portal receipt"
          disabled={isBusy}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-lodged-with`}>
          Lodged with{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${kind}-lodged-with`}
          value={lodgedWith}
          onChange={(event) => setLodgedWith(event.target.value)}
          placeholder={copyPortal}
          disabled={isBusy}
        />
      </div>

      <Button type="submit" size="sm" disabled={isBusy || !appliedAt}>
        {isSaving ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : null}
        Save application
      </Button>
    </form>
  );
}
