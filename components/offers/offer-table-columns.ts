// The offers table's columns, index-matched to its cells. No "use client":
// the route's loading skeleton sizes itself from this same list, so it cannot
// promise a different table from the one that loads.

export type OfferTableHeader = {
  label: string;
  /** Announced but not shown: the column holds a control, not text. */
  srOnly?: boolean;
  /** "end" right-aligns the money columns so the digits line up, as DataTable does. */
  align: "start" | "end";
};

export const OFFER_TABLE_HEADERS: readonly OfferTableHeader[] = [
  { label: "Expand versions", srOnly: true, align: "start" },
  { label: "Offer #", align: "start" },
  { label: "Client", align: "start" },
  { label: "Type", align: "start" },
  { label: "Versions", align: "start" },
  { label: "Amount (Ex GST)", align: "end" },
  { label: "GST", align: "end" },
  { label: "Total", align: "end" },
  { label: "Sent At", align: "start" },
  { label: "Approved At", align: "start" },
  { label: "Status", align: "start" },
];
