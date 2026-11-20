import {
  isClerkAPIResponseError,
  isReverificationCancelledError,
} from "@clerk/nextjs/errors";

/**
 * Clerk's own sentence for a refused request ("Password has been found in an
 * online data breach…"), or the fallback. Clerk's error class carries the bare
 * status text as `message`, which tells the person nothing.
 */
export function clerkErrorMessage(error: unknown, fallback: string): string {
  if (isClerkAPIResponseError(error)) {
    const first = error.errors[0];
    return first?.longMessage || first?.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** The person closed the "confirm it's you" dialog: not an error to show. */
export function wasReverificationCancelled(error: unknown): boolean {
  return isReverificationCancelledError(error);
}
