/**
 * Whether a field name holds a record id: `id`, `leadId`, `affectedProjectIds`.
 *
 * Ids are how tools address records and mean nothing to the office, so the
 * places that show agent output to people — the workspace result card and the
 * MCP approval prompt — leave these fields out. One rule for both, so a field
 * hidden in one is never shown in the other.
 */
export function isRecordIdField(name: string): boolean {
  return /(^id$|Id$|Ids$)/.test(name);
}
