"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NSW_PLANNING_PORTAL_URL } from "@/constants/complianceDocuments";
import { businessDaysSince } from "@/lib/dates/business-days";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  recordPlanningCertificate,
  selectComplianceMutation,
} from "@/lib/store/slices/projectsSlice";
import {
  planningCertificateStep,
  type PlanningCertificateRecord,
} from "@/types/compliance";
import { dateFormat } from "@/utils/formatters";
import type { PlanningCertificateRequest } from "@/utils/validators/compliance";

/**
 * The 10.7(2) & (5) certificate, from "do we have one?" through to the file.
 *
 * This block used to be a yes/no held in `useState` on the section around it.
 * That was honest while the only two outcomes were "upload it" and "go and buy
 * one" — but buying one takes the NSW Planning Portal three to five working
 * days, and nothing recorded that an application existed. So a job where
 * somebody had lodged one on Monday looked exactly like a job where nobody had
 * done anything at all, the answer was forgotten the moment the tab was left,
 * and there was no date for anything to be late against.
 *
 * Every answer here is persisted, which is what makes the daily sweep possible:
 * an application with a lodgement date is a clock, and a clock is the only
 * thing an alert can be raised off.
 *
 * The steps are derived from the row rather than held here — see
 * `planningCertificateStep`. The only local state is the two disclosures: a
 * form somebody has opened and not submitted, which is a fact about this
 * render and nothing else.
 */

/** The turnaround the portal quotes, and what the copy on this block says. */
const PORTAL_BUSINESS_DAYS = 5;

type CouncilCertificateBlockProps = {
  projectId: string;
  application: PlanningCertificateRecord;
  /** The certificate's own document row, rendered once it can be uploaded. */
  documentRows: ReactNode;
};

export function CouncilCertificateBlock({
  projectId,
  application,
  documentRows,
}: CouncilCertificateBlockProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.planningCertificate),
  );
  const isBusy = mutation.status === "pending";

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

  const step = planningCertificateStep(application);

  const save = async (
    payload: PlanningCertificateRequest,
    success: string,
  ) => {
    try {
      await dispatch(
        recordPlanningCertificate({ projectId, ...payload }),
      ).unwrap();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save that against the planning certificate.",
      );
      return false;
    }
  };

  // -----------------------------------------------------------------
  // Step 1 — nobody has been asked yet.
  // -----------------------------------------------------------------
  if (step === "unanswered") {
    return (
      <>
        <p className="font-medium text-foreground">
          Do you already have the planning certificate?
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() =>
              void save(
                { step: "answer", alreadyHeld: true },
                "Noted — upload the certificate below.",
              )
            }
          >
            {isBusy ? (
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
                { step: "answer", alreadyHeld: false },
                "Noted — order it on the portal when you can.",
              )
            }
          >
            No
          </Button>
        </div>
      </>
    );
  }

  // -----------------------------------------------------------------
  // Steps 2 and 5 — there is a certificate to put on the file.
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
            ? "Marked as received. Upload the certificate to put it on the file."
            : "Upload the certificate you are holding."}
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
          Order the Section 10.7(2) &amp; (5) certificate for this lot on the NSW
          Planning Portal, then record the application here.{" "}
          <a
            href={NSW_PLANNING_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            NSW Planning Portal
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </p>

        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Checkbox
            checked={isLodgementOpen}
            onCheckedChange={(checked) => setIsLodgementOpen(checked === true)}
            disabled={isBusy}
          />
          Applied for the planning certificate
        </label>

        {isLodgementOpen ? (
          <LodgementForm
            isBusy={isBusy}
            application={application}
            onSubmit={async (values) => {
              const saved = await save(
                { step: "applied", ...values },
                "Application recorded — we will flag it if the portal takes too long.",
              );
              if (saved) setIsLodgementOpen(false);
            }}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Tick this once it is lodged. The portal usually answers within three
            to five working days — recording the date is what lets us tell you
            when it has not.
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
  const isOverdue = elapsed > PORTAL_BUSINESS_DAYS;

  return (
    <div className="space-y-3">
      <dl className="space-y-1 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm">
        <DetailRow
          label="Lodged"
          value={appliedAt ? dateFormat.format(appliedAt) : "—"}
        />
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
          ? "Lodged today. The portal usually answers within three to five working days."
          : isOverdue
            ? `${elapsed} working days with the portal — past the three to five it usually takes. Chase it with the council using the application number.`
            : `${elapsed} working day${elapsed === 1 ? "" : "s"} with the portal, of the three to five it usually takes.`}
      </p>

      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Checkbox
          checked={false}
          disabled={isBusy}
          onCheckedChange={(checked) => {
            if (checked !== true) return;
            void save(
              { step: "received", received: true },
              "Marked as received — upload the certificate below.",
            );
          }}
        />
        Received the planning certificate
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
          isBusy={isBusy}
          application={application}
          onSubmit={async (values) => {
            const saved = await save(
              { step: "applied", ...values },
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
  application,
  isBusy,
  onSubmit,
}: {
  application: PlanningCertificateRecord;
  isBusy: boolean;
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
        <Label htmlFor="planning-applied-at">Date submitted</Label>
        <Input
          id="planning-applied-at"
          type="date"
          value={appliedAt}
          max={asInputDate(today)}
          onChange={(event) => setAppliedAt(event.target.value)}
          disabled={isBusy}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="planning-application-ref">
          Application number{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="planning-application-ref"
          value={applicationRef}
          onChange={(event) => setApplicationRef(event.target.value)}
          placeholder="From the portal receipt"
          disabled={isBusy}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="planning-lodged-with">
          Council or portal{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="planning-lodged-with"
          value={lodgedWith}
          onChange={(event) => setLodgedWith(event.target.value)}
          placeholder="NSW Planning Portal"
          disabled={isBusy}
        />
      </div>

      <Button type="submit" size="sm" disabled={isBusy || !appliedAt}>
        {isBusy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : null}
        Save application
      </Button>
    </form>
  );
}
