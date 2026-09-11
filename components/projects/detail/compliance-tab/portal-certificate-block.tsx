"use client";

import { ComplianceDocumentType } from "@prisma/client";

import {
  CERTIFICATE_DOCUMENT_TYPE,
  certificateKindFor,
  certificateLodgementBlockedReason,
  hasCertificate,
  type CertificateApplicationKind,
} from "@/lib/compliance/portal-certificates";
import type {
  CertifierEngagementDetail,
  ComplianceDocumentWithFiles,
  ComplianceExternalApplicationRecord,
} from "@/types/compliance";
import { CertificateAndCoverSection } from "./certificate-and-cover-section";
import { PlanningPortalSection } from "./planning-portal-section";

export type PortalCertificateValues = {
  certificateKind: CertificateApplicationKind;
  certificateDocument: ComplianceDocumentWithFiles | undefined;
  certificateApplicationRow: ComplianceExternalApplicationRecord | null;
  portalBlocked: string | null;
  certificateHeld: boolean;
};

export function portalCertificateValues(params: {
  engagement: CertifierEngagementDetail;
  documentsByType: ReadonlyMap<ComplianceDocumentType, ComplianceDocumentWithFiles>;
  developerBlocked: string | null;
}): PortalCertificateValues {
  const certificateKind = certificateKindFor(params.engagement);

  return {
    certificateKind,
    certificateDocument: params.documentsByType.get(
      CERTIFICATE_DOCUMENT_TYPE[certificateKind],
    ),
    certificateApplicationRow: params.engagement.externalApplications.find(
      (application) => application.kind === certificateKind,
    ) ?? null,
    portalBlocked: certificateLodgementBlockedReason(
      params.engagement,
      params.developerBlocked,
    ),
    certificateHeld: hasCertificate(params.engagement),
  };
}

type PortalCertificateBlockProps = {
  projectId: string;
  engagement: CertifierEngagementDetail;
  values: PortalCertificateValues;
  insurance: ComplianceDocumentWithFiles | undefined;
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
  portalIsActive: boolean;
  portalOpen: boolean;
  onPortalOpenChange: (open: boolean) => void;
  certificateIsActive: boolean;
  certificateOpen: boolean;
  onCertificateOpenChange: (open: boolean) => void;
};

export function PortalCertificateBlock({
  projectId,
  engagement,
  values,
  insurance,
  checklistPassed,
  rowMode,
  isRowBusy,
  onUpload,
  onPreviewFile,
  portalIsActive,
  portalOpen,
  onPortalOpenChange,
  certificateIsActive,
  certificateOpen,
  onCertificateOpenChange,
}: PortalCertificateBlockProps) {
  return (
    <>
      <PlanningPortalSection
        className="md:col-span-2"
        projectId={projectId}
        kind={values.certificateKind}
        application={values.certificateApplicationRow}
        certificate={values.certificateDocument}
        principalCertifierAppointedAt={engagement.principalCertifierAppointedAt}
        principalCertifierAppointmentRef={
          engagement.principalCertifierAppointmentRef
        }
        certifierName={engagement.certifierName}
        blockedReason={values.portalBlocked}
        rowMode={rowMode}
        isRowBusy={isRowBusy}
        onUpload={onUpload}
        onPreviewFile={onPreviewFile}
        isActive={portalIsActive}
        open={portalOpen}
        onOpenChange={onPortalOpenChange}
      />
      <CertificateAndCoverSection
        className="md:col-span-2"
        certificate={values.certificateDocument}
        certificateDocumentType={
          CERTIFICATE_DOCUMENT_TYPE[values.certificateKind]
        }
        insurance={insurance}
        checklistPassed={checklistPassed}
        rowMode={rowMode}
        isRowBusy={isRowBusy}
        onUpload={onUpload}
        onPreviewFile={onPreviewFile}
        isActive={certificateIsActive}
        open={certificateOpen}
        onOpenChange={onCertificateOpenChange}
      />
    </>
  );
}
