import {
  sydneyDayRange,
  type SydneyDayRange,
  type SydneyDayRangeInput,
} from "@/lib/dates/day-range";
import { DomainValidationError } from "./errors";

/**
 * A window of Sydney days from a brief (#618), or a refusal the operator can
 * read: a window that ends before it starts, or is longer than one read
 * covers. Shared by the lead, meeting, milestone and offer reads.
 */
export function resolveDayRange(
  input: SydneyDayRangeInput,
  now: Date,
): SydneyDayRange {
  try {
    return sydneyDayRange(input, now);
  } catch (error) {
    if (error instanceof RangeError)
      throw new DomainValidationError(error.message, "range");
    throw error;
  }
}
