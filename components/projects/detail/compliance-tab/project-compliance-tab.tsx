"use client";

import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
} from "@prisma/client";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CERTIFIER_RESPONSE_DOCUMENTS,
  complianceDocumentLabel,
  HBCF_INSURANCE_URL,
  REQUIRED_COMPLIANCE_DOCUMENTS,
  SIGNED_COPY_DOCUMENTS,
} from "@/constants/complianceDocuments";
import { useComplianceUpload } from "@/hooks/use-compliance-upload";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import {
  resolveComplianceDocument,
  sendCertifierReply,
  sendComplianceForReview,
  uploadComplianceDocument,
} from "@/lib/store/slices/projectsSlice";
import type { ProjectDetail } from "@/types/project";
import type { ComplianceDocumentWithFiles } from "@/types/compliance";
import { filePreviewModal } from "@/utils/file-preview";
import type { CertifierReplyAttachment } from "@/utils/validators/compliance";
import { CertifierThread } from "./certifier-thread";
import { ComplianceDocumentRow } from "./compliance-document-row";
import { ComplianceDocumentVault } from "./compliance-document-vault";
import { ComplianceFinalPage } from "./compliance-final-page";

type ProjectComplianceTabProps = {
  project: ProjectDetail;
  isAdmin: boolean;
};

export function ProjectComplianceTab({
  project,
  isAdmin,
}: ProjectComplianceTabProps) {
  const dispatch = useAppDispatch();
  const mutation = useAppSelector((state) => state.projects.mutations.compliance);
  const isBusy = mutation.status === "pending";
  const { uploadFile, uploadingKey } = useComplianceUpload(project.id);
  const [insuranceAnswer, setInsuranceAnswer] = useState<"yes" | "no" | null>(
    null,
  );

  const engagement = project.certifierEngagement;

  const documentsByType = useMemo(() => {
    const map = new Map<ComplianceDocumentType, ComplianceDocumentWithFiles>();
    for (const document of engagement?.documents ?? []) {
      if (!map.has(document.documentType)) {
        map.set(document.documentType, document);
      }
    }
    return map;
  }, [engagement]);

  /**
   * Every file on the engagement, in the order the documents are listed.
   *
   * This is the gallery pool. Opening a site photo attached to one checklist
   * item lets the viewer page through every other photo on the engagement,
   * rather than the one or two on that row — which is what someone comparing
   * evidence across items actually wants.
   */
  const previewFiles = useMemo(
    () =>
      (engagement?.documents ?? []).flatMap((document) =>
        document.files.map((file) => ({
          id: file.id,
          url: file.url,
          name: file.filename,
          fileType: file.fileType,
        })),
      ),
    [engagement],
  );

  const handlePreviewFile = (fileId: string) => {
    const index = previewFiles.findIndex((file) => file.id === fileId);
    const action = filePreviewModal(previewFiles, index);
    if (action) dispatch(openModal(action));
  };

  const checklistItems = useMemo(
    () =>
      (engagement?.documents ?? [])
        .filter(
          (document) =>
            document.documentType === ComplianceDocumentType.CHECKLIST_ITEM,
        )
        .sort((a, b) => a.order - b.order),
    [engagement],
  );

  /**
   * Uploads a file and points a compliance document at it.
   *
   * One helper for every upload control on the tab, because they differ only in
   * which document they target — a seeded row by id, or a type that has no row
   * until now.
   */
  const attach = async (
    file: File,
    key: string,
    target: { documentId?: string; documentType?: ComplianceDocumentType },
  ) => {
    try {
      const uploaded = await uploadFile(file, key);
      await dispatch(
        uploadComplianceDocument({
          projectId: project.id,
          fileId: uploaded.fileId,
          ...target,
        }),
      ).unwrap();
      toast.success(`${file.name} uploaded.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Could not upload ${file.name}.`,
      );
    }
  };

  const handleReply = async (input: {
    body: string;
    attachments: CertifierReplyAttachment[];
  }) => {
    await dispatch(
      sendCertifierReply({ projectId: project.id, ...input }),
    ).unwrap();
    toast.success("Sent to the certifier.");
  };

  const handleResolve = async (
    document: ComplianceDocumentWithFiles,
    decision: "approved" | "rejected",
  ) => {
    let rejectionReason: string | undefined;
    if (decision === "rejected") {
      // A reason is mandatory server-side, so it is collected before the call
      // rather than letting the request come back as a validation error.
      const reason = window.prompt(
        `Why is "${complianceDocumentLabel(document.documentType, document.label)}" being sent back?`,
      );
      if (!reason?.trim()) {
        return;
      }
      rejectionReason = reason.trim();
    }

    try {
      await dispatch(
        resolveComplianceDocument({
          projectId: project.id,
          documentId: document.id,
          decision,
          rejectionReason,
        }),
      ).unwrap();
      toast.success(decision === "approved" ? "Approved." : "Sent back.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not resolve the document.",
      );
    }
  };

  // ---------------------------------------------------------------------
  // Nothing started yet — one button, as specified.
  // ---------------------------------------------------------------------

  if (!engagement) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Compliance and certification
          </CardTitle>
          <CardDescription>
            Collect the required documents, send them to the principal
            certifier, and track their checklist through to approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            onClick={() =>
              dispatch(
                openModal({
                  type: "startCertifierEngagement",
                  payload: {
                    projectId: project.id,
                    defaultAddress: project.location,
                  },
                }),
              )
            }
          >
            Connect with Certifier
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------
  // Everything approved — frozen, categorised, read-only.
  // ---------------------------------------------------------------------

  if (engagement.status === CertifierEngagementStatus.APPROVED) {
    return <ComplianceFinalPage documents={engagement.documents} />;
  }

  const collecting =
    engagement.status === CertifierEngagementStatus.NOT_STARTED ||
    engagement.status === CertifierEngagementStatus.COLLECTING_DOCS;

  const hasResponse = engagement.documents.some(
    (document) =>
      document.status === ComplianceDocumentStatus.RECEIVED &&
      CERTIFIER_RESPONSE_DOCUMENTS.some(
        (response) => response.type === document.documentType,
      ),
  );

  const signedCopies = SIGNED_COPY_DOCUMENTS.map((signed) => ({
    ...signed,
    document: documentsByType.get(signed.type),
  }));
  const bothSigned = signedCopies.every(
    (signed) => (signed.document?.files.length ?? 0) > 0,
  );

  const checklistDocument = documentsByType.get(ComplianceDocumentType.CHECKLIST);
  const allChecklistUploaded =
    checklistItems.length > 0 &&
    checklistItems.every((item) => item.files.length > 0);
  const inReview = engagement.status === CertifierEngagementStatus.IN_REVIEW;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------
          Required documents
      --------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Required documents</CardTitle>
          <CardDescription>
            These go to the certifier as one pack. Run discovery to find the ones
            already on the project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul>
            {REQUIRED_COMPLIANCE_DOCUMENTS.map((required) => {
              const document = documentsByType.get(required.type);
              return (
                <ComplianceDocumentRow
                  key={required.type}
                  label={required.label}
                  document={document}
                  helperText={
                    document?.files.length ? undefined : "Not collected yet"
                  }
                  mode={inReview ? (isAdmin ? "resolve" : "frozen") : "upload"}
                  isBusy={isBusy || uploadingKey === required.type}
                  onUpload={(file) =>
                    void attach(file, required.type, {
                      documentId: document?.id,
                      documentType: required.type,
                    })
                  }
                  onApprove={() =>
                    document && void handleResolve(document, "approved")
                  }
                  onReject={() =>
                    document && void handleResolve(document, "rejected")
                  }
                  onPreviewFile={handlePreviewFile}
                />
              );
            })}
          </ul>

          {collecting ? (
            <Button
              type="button"
              onClick={() =>
                dispatch(
                  openModal({
                    type: "certifierDiscovery",
                    payload: { projectId: project.id },
                  }),
                )
              }
              disabled={isBusy}
            >
              Find and send documents
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------
          Certifier response
      --------------------------------------------------------------- */}
      {hasResponse ? (
        <Card>
          <CardHeader>
            <CardTitle>Certifier response</CardTitle>
            <CardDescription>
              What came back on the thread. Upload the signed copies to unlock
              the checklist.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul>
              {CERTIFIER_RESPONSE_DOCUMENTS.map((response) => (
                <ComplianceDocumentRow
                  key={response.type}
                  label={response.label}
                  document={documentsByType.get(response.type)}
                  helperText="Not received yet"
                  mode="frozen"
                  onPreviewFile={handlePreviewFile}
                />
              ))}

              {signedCopies.map((signed) => (
                <ComplianceDocumentRow
                  key={signed.type}
                  label={signed.label}
                  document={signed.document}
                  helperText="Please upload the signed copy"
                  mode="upload"
                  isBusy={isBusy || uploadingKey === signed.type}
                  onUpload={(file) =>
                    void attach(file, signed.type, {
                      documentId: signed.document?.id,
                      documentType: signed.type,
                    })
                  }
                  onPreviewFile={handlePreviewFile}
                />
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                // Held shut until both signed copies exist: the certifier will
                // not issue a checklist against an unsigned fee proposal, so
                // asking for one early just wastes a round trip.
                disabled={!bothSigned || !checklistDocument || isBusy}
                onClick={() =>
                  dispatch(
                    openModal({
                      type: "certifierExtract",
                      payload: {
                        projectId: project.id,
                        engagementId: engagement.id,
                        documentId: checklistDocument?.id,
                      },
                    }),
                  )
                }
              >
                Get Checklist
              </Button>
              {!bothSigned ? (
                <p className="text-sm text-muted-foreground">
                  Upload both signed copies first.
                </p>
              ) : !checklistDocument ? (
                <p className="text-sm text-muted-foreground">
                  Waiting on the certifier&apos;s checklist.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------
          Checklist
      --------------------------------------------------------------- */}
      {checklistItems.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
            <CardDescription>
              One document per item the certifier asked for.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul>
              {checklistItems.map((item) => (
                <ComplianceDocumentRow
                  key={item.id}
                  label={complianceDocumentLabel(item.documentType, item.label)}
                  document={item}
                  helperText={item.files.length ? undefined : "Not supplied yet"}
                  mode={
                    inReview
                      ? isAdmin
                        ? "resolve"
                        : "frozen"
                      : item.status === ComplianceDocumentStatus.APPROVED
                        ? "frozen"
                        : "upload"
                  }
                  isBusy={isBusy || uploadingKey === item.id}
                  onUpload={(file) =>
                    void attach(file, item.id, { documentId: item.id })
                  }
                  onApprove={() => void handleResolve(item, "approved")}
                  onReject={() => void handleResolve(item, "rejected")}
                  onPreviewFile={handlePreviewFile}
                />
              ))}
            </ul>

            {/* -------------------------------------------------------
                Home insurance
            ------------------------------------------------------- */}
            {allChecklistUploaded && !inReview ? (
              <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
                <p className="font-medium text-foreground">
                  Have you raised the home insurance?
                </p>

                {documentsByType.get(ComplianceDocumentType.HOME_INSURANCE)
                  ?.files.length ? (
                  <ul className="mt-2">
                    <ComplianceDocumentRow
                      label="Home Insurance"
                      document={documentsByType.get(
                        ComplianceDocumentType.HOME_INSURANCE,
                      )}
                      mode="upload"
                      isBusy={isBusy || uploadingKey === "home-insurance"}
                      onUpload={(file) =>
                        void attach(file, "home-insurance", {
                          documentType: ComplianceDocumentType.HOME_INSURANCE,
                        })
                      }
                      onPreviewFile={handlePreviewFile}
                    />
                  </ul>
                ) : (
                  <>
                    <div className="mt-3 flex gap-2">
                      <Button
                        type="button"
                        variant={insuranceAnswer === "yes" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setInsuranceAnswer("yes")}
                      >
                        Yes
                      </Button>
                      <Button
                        type="button"
                        variant={insuranceAnswer === "no" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setInsuranceAnswer("no")}
                      >
                        No
                      </Button>
                    </div>

                    {insuranceAnswer === "yes" ? (
                      <ul className="mt-2">
                        <ComplianceDocumentRow
                          label="Home Insurance"
                          helperText="Upload the certificate of insurance"
                          mode="upload"
                          isBusy={isBusy || uploadingKey === "home-insurance"}
                          onUpload={(file) =>
                            void attach(file, "home-insurance", {
                              documentType:
                                ComplianceDocumentType.HOME_INSURANCE,
                            })
                          }
                        />
                      </ul>
                    ) : null}

                    {insuranceAnswer === "no" ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        Raise Home Building Compensation Fund cover with icare,
                        then come back and upload the certificate.{" "}
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

            {/* -------------------------------------------------------
                Send for review
            ------------------------------------------------------- */}
            {allChecklistUploaded && !inReview ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success-light px-4 py-3">
                <p className="flex-1 font-medium text-foreground">
                  Compliance and Certification complete
                </p>
                <Button
                  type="button"
                  disabled={isBusy}
                  onClick={async () => {
                    try {
                      await dispatch(
                        sendComplianceForReview({ projectId: project.id }),
                      ).unwrap();
                      toast.success("Sent to the certifier for review.");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Could not send the file.",
                      );
                    }
                  }}
                >
                  {isBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Send it to Certifier
                </Button>
              </div>
            ) : null}

            {inReview && !isAdmin ? (
              <p className="text-sm text-muted-foreground">
                With the certifier for review. An admin approves or rejects each
                document as it comes back.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <CertifierThread
        projectId={project.id}
        emails={engagement.emails}
        isSending={isBusy}
        onSend={handleReply}
      />

      <ComplianceDocumentVault documents={engagement.documents} />
    </div>
  );
}
