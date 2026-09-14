"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { UploadButton } from "@/components/common/upload-button";
import { File as DBFile } from "@prisma/client";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  GitBranch,
} from "lucide-react";
import {
  deriveTenderGateStatus,
  type TenderGateState,
} from "@/lib/offer/workspace-persistence";
import type { OfferWorkspaceStatus } from "@/lib/offer/workspace-model";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { GROUP_HEADING_CLASS } from "./offer-workspace-fields";

// The one-off architectural-plan fee the gate waits on. Manual checkbox only —
// no payment integration is in scope (see plan §7).
const ARCHITECTURAL_PLAN_FEE_LABEL = "$5,000 AUD architectural plan fee collected";

type TenderGatePanelProps = {
  readonly status: OfferWorkspaceStatus;
  readonly tenderGate: TenderGateState;
  readonly leadId?: number;
  readonly onTenderGateChange: (patch: Partial<TenderGateState>) => void;
  // Reuses the workspace-level revision fork exactly as the Send & negotiate
  // step does — forks a brand-new revision at PENDING, not a "back a step".
  readonly onCreateRevision: () => void;
  readonly canRevise: boolean;
  readonly revising: boolean;
};

export function TenderGatePanel({
  status,
  tenderGate,
  leadId,
  onTenderGateChange,
  onCreateRevision,
  canRevise,
  revising,
}: TenderGatePanelProps) {
  const gateStatus = deriveTenderGateStatus(tenderGate);
  const planNeeded = tenderGate.needsArchitecturalPlan;
  const feeCollected = tenderGate.architecturalPlanFeeCollected;
  const uploaded = tenderGate.architecturalPlanUploaded;
  const designChanges = tenderGate.architecturalPlanDesignChanges;

  // Once the offer has moved past AGREED (a Tender was generated), the gate is
  // moot — show the unlocked confirmation and don't re-render the questions.
  const gatePassed = status !== "agreed" && gateStatus === "unlocked";

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Decide whether tender access unlocks immediately or is held pending an architectural-plan fee and upload."
          icon={<Building2 className="size-4" aria-hidden="true" />}
          singleLineDescription
          title="Tender access"
        />
      </CardHeader>
      <CardContent className="grid gap-5">
        {gatePassed ? (
          <Banner tone="success">
            Tender access unlocked — proceed to the Tender step below.
          </Banner>
        ) : (
          <>
            <YesNoQuestion
              label="Do you need an architectural plan?"
              value={planNeeded}
              onChange={(value) =>
                onTenderGateChange({
                  needsArchitecturalPlan: value,
                  // Flipping Q1 resets everything downstream so a stale
                  // fee/upload/design answer can't leak into a fresh branch.
                  architecturalPlanFeeCollected: false,
                  architecturalPlanUploaded: null,
                  architecturalPlanDesignChanges: null,
                })
              }
            />

            {planNeeded === true ? (
              <>
                <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <label className="flex items-start gap-2.5 text-sm text-foreground">
                    <Checkbox
                      checked={feeCollected}
                      onCheckedChange={(checked) =>
                        onTenderGateChange({
                          architecturalPlanFeeCollected: checked === true,
                        })
                      }
                      className="mt-0.5"
                    />
                    <span>{ARCHITECTURAL_PLAN_FEE_LABEL}</span>
                  </label>
                  {!feeCollected ? (
                    <Banner tone="warning">
                      Waiting on the {ARCHITECTURAL_PLAN_FEE_LABEL}. Tender
                      access stays locked until the fee is collected.
                    </Banner>
                  ) : null}
                </div>

                {feeCollected ? (
                  <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                    <p className={GROUP_HEADING_CLASS}>
                      Upload the architectural plan
                    </p>
                    <UploadButton
                      leadId={leadId?.toString()}
                      maxFiles={1}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                      onUpload={(files: DBFile[]) => {
                        const file = files[0];
                        if (!file) {
                          return;
                        }
                        onTenderGateChange({
                          architecturalPlanUploaded: {
                            fileId: file.id,
                            fileName: file.filename,
                            fileSize: file.filesize,
                          },
                          // Reset Q3 so a previous design-changes answer can't
                          // carry over a different uploaded plan.
                          architecturalPlanDesignChanges: null,
                        });
                      }}
                    />
                    {uploaded ? (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                        <CheckCircle2
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        {uploaded.fileName} uploaded — answer the design-changes
                        question below to continue.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        The design-changes question appears once a plan is
                        uploaded.
                      </p>
                    )}
                  </div>
                ) : null}

                {feeCollected && uploaded ? (
                  <>
                    <YesNoQuestion
                      label="Are there any design changes?"
                      value={designChanges}
                      onChange={(value) =>
                        onTenderGateChange({
                          architecturalPlanDesignChanges: value,
                        })
                      }
                    />

                    {designChanges === true ? (
                      <div className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive-light px-3 py-3">
                        <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                          <AlertTriangle
                            className="mt-0.5 size-4 shrink-0 text-destructive"
                            aria-hidden="true"
                          />
                          <span>
                            You can&apos;t proceed — design changes were detected
                            and a revision is required.
                          </span>
                        </p>
                        <div>
                          <Button
                            disabled={!canRevise || revising}
                            onClick={onCreateRevision}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <GitBranch
                              className="size-4"
                              aria-hidden="true"
                            />
                            {revising ? "Creating…" : "Create revision"}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {designChanges === false ? (
                      <Banner tone="success">
                        Tender access unlocked — proceed to the Tender step
                        below.
                      </Banner>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {planNeeded === false ? (
              <Banner tone="success">
                Tender access unlocked — proceed to the Tender step below.
              </Banner>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Reusable Yes/No prompt used for Q1 (architectural plan needed) and Q3
// (design changes). The selected option is highlighted; re-selecting is always
// allowed so the estimator can correct an answer.
function YesNoQuestion({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: boolean | null;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          type="button"
          variant={value === true ? "royal" : "outline"}
          onClick={() => onChange(true)}
        >
          Yes
        </Button>
        <Button
          size="sm"
          type="button"
          variant={value === false ? "royal" : "outline"}
          onClick={() => onChange(false)}
        >
          No
        </Button>
      </div>
    </div>
  );
}

function Banner({
  children,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly tone: "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/30 bg-success-light text-foreground"
      : "border-warning/40 bg-warning-light text-foreground";
  return (
    <p className={`rounded-lg border px-3 py-2.5 text-sm ${toneClass}`}>
      {children}
    </p>
  );
}
