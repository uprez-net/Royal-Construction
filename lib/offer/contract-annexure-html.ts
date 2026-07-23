import { anchor, esc, legalDocShell, masthead } from "./offer-tender-html";

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
  const blocks = args.signers
    .map((signer, index) => {
      const k = index + 1;
      const who = signer.entityName
        ? `${esc(signer.name)}, ${esc(signer.capacity ?? "Director")} of ${esc(signer.entityName)}`
        : `${esc(signer.name)}${signer.capacity ? `, ${esc(signer.capacity)}` : ""}`;
      return `
    <div class="sig">
      <div class="who">${who}</div>
      <div class="lines">
        <div><div class="sigspace">${anchor(`sigAnnex${k}`)}</div><div class="field">Signature</div></div>
        <div><div class="sigspace">${anchor(`dateAnnex${k}`)}</div><div class="field">Date</div></div>
      </div>
    </div>`;
    })
    .join("");

  const body = `<div class="page">
    ${masthead()}
    <h1 class="doc">Owner Signature Schedule</h1>
    <div class="refline">Contract Reference: ${esc(args.reference)}</div>
    <p class="note">This schedule forms part of, and is to be read with, the Residential Building Contract (BC4) between Royal Constructions Pty Ltd and the Owner(s) — ${esc(args.ownerNamesLine)} — for the works at ${esc(args.siteAddress)}. Each owner named below executes the Contract by signing this schedule; their signature has the same effect as signing the Contract's owner execution block.</p>
    ${blocks}
    <p class="note">Signed copies are retained with the executed Contract as the legal system of record. Royal Constructions Pty Ltd · Lic. 383992C · ABN 56 644 111 580.</p>
  </div>`;
  return legalDocShell(body);
}
