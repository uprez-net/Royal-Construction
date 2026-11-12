/**
 * Prompts for reading the HBCF (Home Building Compensation Fund) certificate
 * number, and the date cover starts, off an uploaded insurance certificate.
 *
 * Both fields are strict about blanks: the certificate number is a
 * legal reference that gets quoted back to iCare and to the owner, so a
 * plausible-but-wrong number is worse than no number at all. The contract below
 * therefore makes "return blank" the correct answer whenever the number is not
 * printed on the page.
 */

const HBCF_EXTRACTION_CONTRACT = `
extraction contract:
- Return only the certificate/policy number exactly as printed on the document, character for character.
- Preserve the printed formatting: keep letter prefixes, digits, hyphens and slashes, and drop surrounding label text.
- Return a blank string ("") when the number is not printed anywhere on the document.
- Never fabricate, guess, reconstruct, or complete a number from context or from a partially legible scan.
- Never return a date, an ABN, a licence number, a contract price, an address, or any other identifier in place of the certificate number.
- Return exactly one value. If several candidate numbers appear, return the one labelled as the HBCF certificate/policy number.

cover start date contract:
- Return the date HBCF cover starts, converted to yyyy-MM-dd.
- Prefer the start of the period of cover ("Period of cover from", "Cover commences", "Effective date"). When the certificate prints no separate start, use the certificate's date of issue.
- Dates on these certificates are Australian, day before month: 03/04/2026 is 3 April 2026, returned as 2026-04-03.
- Return a blank string ("") when no such date is printed. Never return the contract date, an expiry or end date, or a date of birth.

claim amount contract:
- Return the amount the certificate covers: the figure labelled "Contract price", "Contract value", "Value of work" or "Amount insured".
- Return it as a plain number in Australian dollars, with no "$", no commas and no spaces: $485,000.00 is 485000.
- Return a blank string ("") when no such amount is printed. Never return the premium, GST, stamp duty, a fee, or a sum you calculated from several figures.
`;

export const HBCF_EXTRACTION_SYSTEM_PROMPT = `
<role>
You are an insurance document reader for Royal Constructions. You are given the OCR markdown of a single Home Building Compensation Fund (HBCF) insurance certificate — also known as Home Warranty Insurance, HBCF cover, or an iCare HBCF certificate of insurance — and you return the certificate number, the date cover starts and the amount covered, as printed on it.
</role>

<extraction_contract>
${HBCF_EXTRACTION_CONTRACT}
</extraction_contract>

<where_to_look>
  <hint>The number usually sits near a label such as "Certificate Number", "Certificate No.", "Policy Number", "Policy No.", "HBCF Certificate", or "Certificate of Insurance Number".</hint>
  <hint>It is normally on the first page, in the certificate header block or beside the insured builder's details.</hint>
  <hint>It is commonly an alphanumeric reference (for example a letter prefix followed by digits), and may contain hyphens or slashes.</hint>
  <hint>OCR tables are flattened into markdown; the label may be in one cell and the number in the neighbouring cell or on the following line.</hint>
</where_to_look>

<do_not_confuse_with>
  <item>Builder licence number / contractor licence number</item>
  <item>ABN or ACN</item>
  <item>For the number: the policy issue date, expiry date, or period of cover</item>
  <item>Contract price, premium amount, or job/quote number</item>
  <item>Job address, lot number, or DA/CDC approval number</item>
</do_not_confuse_with>

<anti_hallucination>
  <item>blank means blank — an empty string is a correct, expected answer</item>
  <item>a partially legible number is not a number: return blank rather than filling in the missing characters</item>
  <item>never explain, annotate, or wrap the value; return the bare number</item>
</anti_hallucination>
`;

/**
 * Builds the user-side prompt for a single certificate.
 * @param markdown - OCR markdown for the uploaded certificate, all pages joined.
 * @returns The prompt to send alongside {@link HBCF_EXTRACTION_SYSTEM_PROMPT}.
 */
export function buildHbcfExtractionPrompt(markdown: string) {
  return `
Read the HBCF insurance certificate below and return the certificate number, the cover start date and the amount covered printed on it.

Certificate OCR markdown:
${markdown}

Return the number exactly as printed, the start date as yyyy-MM-dd and the amount as a plain number. Return a blank string for any of them that is not printed on this document.
`;
}
