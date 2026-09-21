/**
 * A lead write rejected because the request itself is invalid — not because
 * anything went wrong.
 *
 * The API route catches every throw from updateLead/createLead and returns a
 * blanket 500 "Failed to update lead", which is right for a genuine fault and
 * wrong for a rule the caller could satisfy. That distinction has to survive
 * the trip to the client, or the UI can only say "something failed": picking
 * Lost from the stage dropdown just fails, and the user never learns a reason
 * is required.
 *
 * Throw this for rules a caller can fix. The message is written to be shown to
 * a person, so keep it specific and free of internals.
 */
export class LeadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadValidationError";
  }
}

/** Type guard that survives the module boundary better than instanceof. */
export function isLeadValidationError(
  error: unknown,
): error is LeadValidationError {
  return error instanceof Error && error.name === "LeadValidationError";
}
