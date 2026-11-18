"use client";

import { ComplianceDocumentType } from "@prisma/client";
import {
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  History,
} from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { UploadButton } from "@/components/common/upload-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { missingBuildStartDocuments } from "@/lib/domain/compliance/lifecycle";
import type { PriorComplianceDocumentType } from "@/lib/domain/compliance/recorded-outside";
import { projectHbcfCertificateFileId } from "@/lib/domain/insurance/hbcf-claims";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  recordPriorComplianceDocument,
  selectComplianceMutations,
} from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import type { CertifierEngagementDetail } from "@/types/compliance";
import type { ProjectDetail } from "@/types/project";

/** What each row asks for, in the order a person looks for them. */
const ROWS: readonly {
  type: PriorComplianceDocumentType;
  label: string;
  hint: string;
}[] = [
  {
    type: ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE,
    label: "Complying Development Certificate (CDC)",
    hint: "For a job approved as complying development.",
  },
  {
    type: ComplianceDocumentType.CONSTRUCTION_CERTIFICATE,
    label: "Construction Certificate",
    hint: "For a job approved through a development application. Either this or the CDC is needed, not both.",
  },
  {
    type: ComplianceDocumentType.HOME_INSURANCE,
    label: "HBCF certificate",
    hint: "The home warranty (HBCF) certificate. Not needed here if it was already uploaded on the Overview tab.",
  },
  {
    type: ComplianceDocumentType.DEVELOPMENT_CONSENT,
    label: "Development consent",
    hint: "Optional. The council's consent, if the job had one.",
  },
  {
    type: ComplianceDocumentType.BASIX_CERTIFICATE,
    label: "BASIX certificate",
    hint: "Optional.",
  },
];

const ACCEPT = "application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png";

/**
 * Compliance done before the job came into the CRM.
 *
 * Jobs that were already under way when the CRM was built had their
 * certificate issued and their HBCF cover taken out long ago, with no
 * certifier thread here. Running them through Connect with Certifier would
 * chase a certifier for a pack they finished a year ago, and until something
 * is uploaded they sit in Needs attention for want of a construction
 * certificate. This takes the documents they already hold instead.
 *
 * Shown under Connect with Certifier while nothing has been started, and as
 * the whole tab once something has been uploaded here
 * (`isRecordedOutsideCrm`). Each upload goes on a compliance file with no
 * certifier, which every reader of "does this job hold its certificate"
 * already reads, so the Needs attention items clear on their own. The job
 * moves to Active once the certificate and HBCF cover are both held — the
 * same test that closes the normal compliance stage.
 */
export function PriorComplianceSection({
  project,
  engagement,
}: {
  project: ProjectDetail;
  /** The no-certifier file, or null while nothing has been uploaded. */
  engagement: CertifierEngagementDetail | null;
}) {
  const dispatch = useAppDispatch();
  const mutations = useAppSelector(selectComplianceMutations);
  const recorded = engagement !== null;

  const fileFor = (type: ComplianceDocumentType) =>
    engagement?.documents.find(
      (document) => document.documentType === type && document.files.length > 0,
    )?.files[0] ?? null;

  const legal = (
    project.requirements as { legalAdministration?: unknown } | null
  )?.legalAdministration as Parameters<typeof projectHbcfCertificateFileId>[0];
  const hbcfOnProject = projectHbcfCertificateFileId(legal) !== null;
  const held = new Set(
    (engagement?.documents ?? [])
      .filter((document) => document.files.length > 0)
      .map((document) => document.documentType),
  );
  const missing = missingBuildStartDocuments(held, hbcfOnProject);

  const upload = async (
    type: PriorComplianceDocumentType,
    label: string,
    fileId: string | undefined,
  ) => {
    if (!fileId) return;
    try {
      const result = await dispatch(
        recordPriorComplianceDocument({
          projectId: project.id,
          documentType: type,
          fileId,
        }),
      ).unwrap();
      toast.success(
        result.activated
          ? `${label} saved. Compliance is complete and the project is now Active.`
          : `${label} saved.`,
      );
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : `Could not save the ${label.toLowerCase()}.`,
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <History className="size-4 text-primary" aria-hidden="true" />
          {recorded
            ? "Compliance done before the CRM"
            : "Compliance already done?"}
          {recorded ? (
            missing.length === 0 ? (
              <StatusPill tone="success">Complete</StatusPill>
            ) : (
              <StatusPill tone="warning">
                {missing.length === 1
                  ? `Missing the ${missing[0]}`
                  : `Missing the ${missing.join(" and the ")}`}
              </StatusPill>
            )
          ) : null}
        </CardTitle>
        <CardDescription>
          {recorded
            ? "This job's compliance was done before it came into the CRM, so there is no certifier to engage here. Keep its documents below."
            : "If this job was certified before it came into the CRM, there is no need to go through the certifier again. Upload the certificate you already hold below instead."}{" "}
          The project moves to Active once a CDC or Construction Certificate and
          the HBCF certificate are both here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ROWS.map((row) => {
            const file = fileFor(row.type);
            const heldOnProject =
              !file
              && row.type === ComplianceDocumentType.HOME_INSURANCE
              && hbcfOnProject;
            const busy = mutations[`prior:${row.type}`]?.status === "pending";
            return (
              <li
                key={row.type}
                className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  {file || heldOnProject ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-success-ink"
                      aria-hidden="true"
                    />
                  ) : (
                    <CircleDashed
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {row.label}
                    </p>
                    {file ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto max-w-full gap-1 p-0 text-xs"
                        onClick={() =>
                          dispatch(
                            openModal({
                              type: "previewFile",
                              payload: { fileUrl: file.url },
                            }),
                          )
                        }
                      >
                        <span className="truncate">{file.filename}</span>
                        <ExternalLink
                          className="size-3 shrink-0"
                          aria-hidden="true"
                        />
                      </Button>
                    ) : heldOnProject ? (
                      <p className="text-xs text-muted-foreground">
                        Already on the project, uploaded on the Overview tab.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {row.hint}
                      </p>
                    )}
                  </div>
                </div>
                <div className="shrink-0 sm:ml-auto">
                  {busy ? (
                    <p className="text-xs text-muted-foreground" role="status">
                      Saving…
                    </p>
                  ) : (
                    <UploadButton
                      projectId={project.id}
                      maxFiles={1}
                      accept={ACCEPT}
                      hints={{
                        trail: ["Compliance done before the CRM", row.label],
                        tags: ["Compliance", row.label],
                      }}
                      onUpload={(files) =>
                        void upload(row.type, row.label, files[0]?.id)
                      }
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {recorded ? (
          // As on every compliance row: one document per row.
          <p className="mt-2 text-xs text-muted-foreground">
            Uploading on a row that already holds a document replaces it.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
