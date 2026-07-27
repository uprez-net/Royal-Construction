import { anchor, esc, legalDocShell, masthead } from "./offer-tender-html";
import {
  CHARS_PER_LINE_SIGNATURE,
  chunkByEstimatedHeight,
  estimateWrappedLines,
} from "./workspace-model";

// Line budget for one annexure page (the first also carries the binding
// preamble). Verified against real Chromium output.
const ANNEXURE_LINES_PER_PAGE = 26;

// One additional owner/director who signs on the annexure (everyone except the
// primary, who signs the BC4 form itself).
export type ContractAnnexureSigner = {
  readonly name: string;
  readonly capacity?: string | null;
  readonly entityName?: string | null;
};

// "Owner Signature Schedule" appended to the BC4 Contract as document 2 (ADR
// 0003). The BC4 form's OWNER(S) line holds only the primary signature; every
// co-owner / company director signs here instead, because the single form area
// has room for ~2 signatures before the Builder block. Each block carries a
// DocuSign anchor (sigAnnex{k} / dateAnnex{k}) that the send action AutoPlaces a
// signature + date tab onto for that recipient — the same anchor mechanism the
// Tender uses. `esc` strips backslashes so an owner name can't smuggle an anchor.
export function buildContractSignatureAnnexureHtml(args: {
  readonly reference: string;
  readonly siteAddress: string;
  readonly ownerNamesLine: string;
  readonly signers: readonly ContractAnnexureSigner[];
}): string {
  // sigAnnex{k}/dateAnnex{k} use the signer's GLOBAL index so the anchors stay
  // aligned with the DocuSign recipients regardless of how blocks are paginated.
  const blocks = args.signers.map((signer, index) => {
    const k = index + 1;
    // Plain-text twin drives the height estimate (escaping would inflate it).
    const whoText = signer.entityName
      ? `${signer.name}, ${signer.capacity ?? "Director"} of ${signer.entityName}`
      : `${signer.name}${signer.capacity ? `, ${signer.capacity}` : ""}`;
    const who = signer.entityName
      ? `${esc(signer.name)}, ${esc(signer.capacity ?? "Director")} of ${esc(signer.entityName)}`
      : `${esc(signer.name)}${signer.capacity ? `, ${esc(signer.capacity)}` : ""}`;
    const html = `
    <div class="sig">
      <div class="who">${who}</div>
      <div class="lines">
        <div><div class="sigspace">${anchor(`sigAnnex${k}`)}</div><div class="field">Signature</div></div>
        <div><div class="sigspace">${anchor(`dateAnnex${k}`)}</div><div class="field">Date</div></div>
      </div>
    </div>`;
    return {
      html,
      // Fixed chrome (border, signature space, date rule) plus wrapped name.
      lines: 6 + estimateWrappedLines(whoText, CHARS_PER_LINE_SIGNATURE),
    };
  });

  // This schedule exists precisely to carry the OVERFLOW signers (up to
  // MAX_OWNER_SIGNERS - 1 = 9), yet emitted them all on a single A4 page — so on
  // the very case it was built for, blocks ran past the page and a signature line
  // could land on a different physical page from the name it belongs to, on a
  // document that is legally executed (PR #124 review — same class as the Tender
  // execution page). Chunk them at the shared per-page limit.
  // Height-aware, like the Tender and Proposal: a director of a long-named
  // company renders as "Name, Director of <full legal name>" and wraps, so a
  // fixed blocks-per-page count under-counted the real height (PR #124 review).
  const chunks: string[][] = chunkByEstimatedHeight(
    blocks,
    ANNEXURE_LINES_PER_PAGE,
    (block) => block.lines,
  ).map((chunk) => chunk.map((block) => block.html));
  if (chunks.length === 0) {
    chunks.push([]);
  }

  const body = chunks
    .map((chunk, index) => {
      const continued = index > 0;
      const last = index === chunks.length - 1;
      const preamble = continued
        ? ""
        : `<p class="note">This schedule forms part of, and is to be read with, the Residential Building Contract (BC4) between Royal Constructions Pty Ltd and the Owner(s) — ${esc(args.ownerNamesLine)} — for the works at ${esc(args.siteAddress)}. Each owner named below executes the Contract by signing this schedule; their signature has the same effect as signing the Contract's owner execution block.</p>`;
      const closing = last
        ? `<p class="note">Signed copies are retained with the executed Contract as the legal system of record. Royal Constructions Pty Ltd · Lic. 383992C · ABN 56 644 111 580.</p>`
        : "";
      return `<div class="page">
    ${masthead()}
    <h1 class="doc">Owner Signature Schedule${continued ? " (cont.)" : ""}</h1>
    <div class="refline">Contract Reference: ${esc(args.reference)}</div>
    ${preamble}
    ${chunk.join("")}
    ${closing}
  </div>`;
    })
    .join("");
  return legalDocShell(body);
}
