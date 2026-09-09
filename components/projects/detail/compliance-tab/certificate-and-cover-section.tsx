"use client";

import { ComplianceDocumentType } from "@prisma/client";
import { Award, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  complianceDocumentLabel,
  HBCF_INSURANCE_URL,
} from "@/constants/complianceDocuments";
import type { ComplianceDocumentWithFiles } from "@/types/compliance";

import { ComplianceDocumentRow } from "./compliance-document-row";
import { ComplianceSectionCard } from "./compliance-section-card";

/**
 * The last two documents on a compliance file.
 *
 * The certifier issues the construction certificate once every checklist line
 * has passed. The builder puts the HBCF certificate of insurance on the file.
 * With both there the compliance stage is finished and the build can start,
 * which is what moves the project to COMPLIANCE_COMPLETED.
 *
 * The insurance question used to sit at the bottom of the checklist card, on
 * the reading that the certifier wants the cover in the pack they review. That
 * is true of the *document* — a certifier's checklist routinely asks for the
 * HBCF warranty by name, and a line asking for it is answered like any other —
 * but it was the wrong place to put the question. It appeared the moment every
 * checklist row had a file on it, which is weeks before the certifier has
 * finished with them, and a builder who answered "no" was then told to go and
 * raise cover for a job that might still come back with four amendments.
 *
 * So the question moved here, behind the certificate. Cover is raised against a
 * job that is definitely proceeding, and the whole block is the answer to "what
 * is left" rather than one more thing on a list of twenty.
 *
 * Uploading it early still works and still counts: a checklist line asking for
 * the warranty is answered on that row, the document lands under the same type,
 * and the file closes the moment the certificate arrives. This block is where
 * it is *asked for*, not the only door it can come through.
 */

type CertificateAndCoverSectionProps = {
  certificate: ComplianceDocumentWithFiles | undefined;
  insurance: ComplianceDocumentWithFiles | undefined;
  /**
   * Whether the certifier has finished with the checklist.
   *
   * The card is locked until then rather than hidden, because a reader
   * scrolling a finished-looking file needs to see that there are two things
   * still to come and what will trigger them.
   */
  checklistPassed: boolean;
  rowMode: (
    document?: ComplianceDocumentWithFiles,
  ) => "upload" | "resolve" | "frozen";
  isRowBusy: (
    document: ComplianceDocumentWithFiles | undefined,
    documentType: ComplianceDocumentType,
  ) => boolean;
  onUpload: (
    file: File,
    target: { documentId?: string; documentType: ComplianceDocumentType },
  ) => void;
  onPreviewFile: (fileId: string) => void;
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
};

export function CertificateAndCoverSection({
  certificate,
  insurance,
  checklistPassed,
  rowMode,
  isRowBusy,
  onUpload,
  onPreviewFile,
  isActive,
  open,
  onOpenChange,
  className,
}: CertificateAndCoverSectionProps) {
  /**
   * Whether the builder says cover has been raised.
   *
   * Local, and deliberately not persisted. The answer is not a fact about the
   * job — the certificate being on the file is — and a stored "yes" would be a
   * job claiming cover it cannot produce. It exists only to decide which of two
   * things this render shows next.
   */
  const [hasRaisedCover, setHasRaisedCover] = useState<"yes" | "no" | null>(
    null,
  );

  const hasCertificate = Boolean(certificate?.files.length);
  const hasCover = Boolean(insurance?.files.length);

  const insuranceTarget = insurance?.files.length
    ? { documentId: insurance.id, documentType: ComplianceDocumentType.HOME_INSURANCE }
    : { documentType: ComplianceDocumentType.HOME_INSURANCE };

  return (
    <ComplianceSectionCard
      title="Certificate and cover"
      description="The last two documents — the certifier's certificate, and the HBCF cover."
      icon={Award}
      progress={{
        done: (hasCertificate ? 1 : 0) + (hasCover ? 1 : 0),
        total: 2,
      }}
      open={open}
      onOpenChange={onOpenChange}
      isActive={isActive}
      locked={!checklistPassed && !hasCertificate}
      lockMessage="Unlocks when the certifier has passed every checklist item and issues the construction certificate."
      className={className}
    >
      <ul>
        <ComplianceDocumentRow
          label={complianceDocumentLabel(
            ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
          )}
          document={certificate}
          helperText={
            hasCertificate
              ? undefined
              : "Issued by the certifier once every item has passed. It is filed here automatically when it arrives on their thread — upload it if they send it another way."
          }
          mode={rowMode(certificate)}
          isBusy={isRowBusy(
            certificate,
            ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
          )}
          onUpload={(file) =>
            onUpload(file, {
              documentId: certificate?.id,
              documentType: ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
            })
          }
          onPreviewFile={onPreviewFile}
        />
      </ul>

      {/* -------------------------------------------------------------
          The cover.

          Behind the certificate, because that is the point of moving it: cover
          is raised against a job that is definitely proceeding. A file that
          already holds it — answered off a checklist line months ago — shows
          the row rather than the question, because there is nothing left to
          ask.
      ------------------------------------------------------------- */}
      {hasCertificate || hasCover ? (
        <div className="mt-4 rounded-lg border border-border/70 bg-muted/40 p-4">
          {hasCover ? (
            <ul>
              <ComplianceDocumentRow
                label={complianceDocumentLabel(
                  ComplianceDocumentType.HOME_INSURANCE,
                )}
                document={insurance}
                mode={rowMode(insurance)}
                isBusy={isRowBusy(
                  insurance,
                  ComplianceDocumentType.HOME_INSURANCE,
                )}
                onUpload={(file) => onUpload(file, insuranceTarget)}
                onPreviewFile={onPreviewFile}
              />
            </ul>
          ) : (
            <>
              <p className="font-medium text-foreground">
                Have you raised the home insurance?
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Home Building Compensation Fund cover for the owners. It is the
                last thing on this file — the project is compliance-complete
                once the certificate is on it.
              </p>

              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant={hasRaisedCover === "yes" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setHasRaisedCover("yes")}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={hasRaisedCover === "no" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setHasRaisedCover("no")}
                >
                  No
                </Button>
              </div>

              {hasRaisedCover === "yes" ? (
                <ul className="mt-2">
                  <ComplianceDocumentRow
                    label={complianceDocumentLabel(
                      ComplianceDocumentType.HOME_INSURANCE,
                    )}
                    helperText="Upload the certificate of insurance"
                    mode="upload"
                    isBusy={isRowBusy(
                      insurance,
                      ComplianceDocumentType.HOME_INSURANCE,
                    )}
                    onUpload={(file) => onUpload(file, insuranceTarget)}
                  />
                </ul>
              ) : null}

              {hasRaisedCover === "no" ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Raise Home Building Compensation Fund cover with icare, then
                  come back and upload the certificate.{" "}
                  <a
                    href={HBCF_INSURANCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    icare HBCF
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </ComplianceSectionCard>
  );
}
