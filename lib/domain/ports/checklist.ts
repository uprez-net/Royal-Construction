// What the project checklists reach outside for: Graph to email a tradie
// about a defect, Chromium to print the downloaded checklist, Blob to remove a
// photo the reviewer attached by mistake. Taken as ports so the command that
// decides is the one that acts, and a test can prove nothing was sent when a
// rule refused.

/** One photo attached to an issue email, as the File row records it. */
export type ChecklistEmailPhoto = {
  readonly url: string;
  readonly filename: string;
  readonly contentType: string;
};

export type ChecklistIssueEmailPort = (input: {
  readonly to: string;
  readonly subject: string;
  /** Plain text as the reviewer edited it; the adapter lays it out. */
  readonly body: string;
  readonly photos: readonly ChecklistEmailPhoto[];
}) => Promise<void>;

/** Everything the downloaded checklist prints. */
export type ChecklistDocumentData = {
  readonly projectName: string;
  readonly projectAddress: string;
  readonly houseType: string;
  readonly checklistNumber: number;
  readonly checklistTitle: string;
  readonly stageLabel: string;
  /** Closed and signed off. Anything else prints as a draft. */
  readonly final: boolean;
  readonly configured: boolean;
  readonly version: number;
  readonly checkedBy: string | null;
  readonly comments: string | null;
  readonly sections: ReadonlyArray<{
    readonly section: string;
    readonly items: ReadonlyArray<{
      readonly label: string;
      readonly state: "UNCHECKED" | "CHECKED" | "NOT_APPLICABLE";
      readonly naReason: string | null;
      /** Unverified issues on this row, by number. */
      readonly openIssueNumbers: readonly number[];
    }>;
  }>;
  readonly issues: ReadonlyArray<{
    readonly number: number;
    readonly location: string;
    readonly description: string;
    readonly statusLabel: string;
    readonly tradieName: string | null;
    readonly verifiedAt: Date | null;
  }>;
  readonly reviewerName: string;
  readonly signatureDataUrl: string;
  readonly signedAt: Date;
  readonly closedAt: Date | null;
};

/** Render the checklist document to PDF bytes. */
export type ChecklistDocumentRenderPort = (
  document: ChecklistDocumentData,
) => Promise<Uint8Array>;
