import type { Prisma } from "@prisma/client";

/**
 * What a compliance read pulls in.
 *
 * Declared here rather than beside the queries because both the data layer and
 * the project detail payload use it, and `lib/data/compliance.ts` is a
 * `"use server"` module — importing a type out of one into a file a client
 * component reads would drag the whole action module along with it.
 */
export const certifierEngagementInclude = {
  documents: {
    include: { files: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  },
  emails: { orderBy: { sentAt: "asc" } },
} satisfies Prisma.CertifierEngagementInclude;

/** The engagement plus everything the Compliance tab renders, in one read. */
export type CertifierEngagementDetail = Prisma.CertifierEngagementGetPayload<{
  include: typeof certifierEngagementInclude;
}>;

export type ComplianceDocumentWithFiles =
  CertifierEngagementDetail["documents"][number];

export type CertifierEmailRecord = CertifierEngagementDetail["emails"][number];

/**
 * One attachment as stored on `CertifierEmail.attachments`.
 *
 * A name and a url, nothing else. The bytes live in blob storage; the row only
 * has to be enough to render a download link inside a thread bubble.
 */
export interface CertifierEmailAttachment {
  name: string;
  url: string;
}

/**
 * Reads the attachments off an email row.
 *
 * The column is `Json`, so it is whatever was written there — including, for
 * rows predating a shape change, something that is not an array at all. Parsed
 * defensively so one malformed row renders an empty bubble rather than taking
 * the whole thread down.
 */
export function certifierEmailAttachments(
  value: unknown,
): CertifierEmailAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { name?: unknown }).name === "string" &&
      typeof (item as { url?: unknown }).url === "string"
    ) {
      const { name, url } = item as { name: string; url: string };
      return [{ name, url }];
    }
    return [];
  });
}
