import type {
  ComplianceDocumentType,
  CompliancePartyType,
} from "@prisma/client";

import { PARTY_OUTREACH_ATTACHMENTS } from "@/constants/complianceDocuments";

/**
 * The files an opening outreach to this party carries on its own: every file on
 * the engagement's documents of the party's standard types. One definition for
 * the send, the approval card, Eve's prepare step and the compliance tab, so
 * what is shown is what goes (#366).
 */
export function outreachPackFiles<File>(
  documents: readonly {
    documentType: ComplianceDocumentType;
    files: readonly File[];
  }[],
  party: CompliancePartyType,
): File[] {
  const types = new Set<ComplianceDocumentType>(
    PARTY_OUTREACH_ATTACHMENTS[party],
  );
  return documents
    .filter((document) => types.has(document.documentType))
    .flatMap((document) => [...document.files]);
}
