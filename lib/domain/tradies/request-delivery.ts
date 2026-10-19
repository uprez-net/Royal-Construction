import { TradieRequestDeliveryStatus } from "@prisma/client";

// When a tradie request email is retried, and what the office is told.
//
// Pure, so the command that sends, the workflow that retries and the screens
// that offer a Retry button all read the same rules.
//
// The asymmetry is deliberate. A failure that clearly was not a send — Graph
// throttling us, the service down, a connection refused before anything left —
// is retried automatically, because doing nothing is the likelier way to lose
// the tradie. A failure that might have been a send — a timeout, a gateway
// error after the request went out — is not, because a robot emailing a tradie
// twice is the expensive kind of mistake and a person can check the Sent
// folder. A refusal (a bad address) is not retried either: it would only be
// refused again.

/** Waits after attempt 1, 2 and 3. Attempt 4 is the last automatic one. */
export const REQUEST_RETRY_DELAYS_MS: readonly number[] = [
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
];

export const MAX_AUTOMATIC_ATTEMPTS = REQUEST_RETRY_DELAYS_MS.length + 1;

/**
 * How long past its due time a scheduled retry may sit before a person may
 * take over. The workflow normally runs within a minute of `nextAttemptAt`; one
 * that never starts must not leave the email stuck behind "retrying".
 */
export const OVERDUE_RETRY_GRACE_MS = 10 * 60_000;

/**
 * - `transient`: clearly not sent; safe for a robot to try again.
 * - `rejected`: the mail server said no; retrying the same email will not help.
 * - `ambiguous`: it may have gone; a person should check before resending.
 */
export type RequestSendFailure = "transient" | "rejected" | "ambiguous";

export type RequestDeliveryState = {
  readonly deliveryStatus: TradieRequestDeliveryStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date | string | null;
};

export type DeliveryAfterFailure = {
  readonly deliveryStatus: TradieRequestDeliveryStatus;
  readonly nextAttemptAt: Date | null;
  readonly lastError: string;
};

/**
 * Where a recipient lands after attempt number `attempt` failed.
 *
 * A retry a person pressed is never followed by an automatic one: they asked
 * for one go and are watching the result.
 */
export function deliveryAfterFailure(
  failure: RequestSendFailure,
  attempt: number,
  trigger: "initial" | "automatic" | "manual",
  now: Date,
): DeliveryAfterFailure {
  if (
    failure === "transient"
    && trigger !== "manual"
    && attempt < MAX_AUTOMATIC_ATTEMPTS
  ) {
    return {
      deliveryStatus: TradieRequestDeliveryStatus.RETRYING,
      lastError:
        "The email service was unavailable. It will be tried again automatically.",
      nextAttemptAt: new Date(
        now.getTime() + REQUEST_RETRY_DELAYS_MS[attempt - 1],
      ),
    };
  }
  return {
    deliveryStatus: TradieRequestDeliveryStatus.FAILED,
    lastError: failureMessage(failure, attempt, trigger),
    nextAttemptAt: null,
  };
}

function failureMessage(
  failure: RequestSendFailure,
  attempt: number,
  trigger: "initial" | "automatic" | "manual",
): string {
  switch (failure) {
    case "rejected":
      return "The mail server refused this email. Check the tradie's email address in the directory, then retry.";
    case "ambiguous":
      return "The email service did not confirm the send, so it may have gone out. Check the Sent folder before retrying.";
    case "transient":
      return trigger === "manual"
        ? "The email service is still unavailable. Try again shortly."
        : `The email service was unavailable on all ${attempt} attempts. Retry once it is back.`;
  }
}

/**
 * May a person retry this email now?
 *
 * Yes once it has failed, and also when an automatic retry is overdue — the
 * workflow that should have run it may never have started. Not while an
 * attempt is in flight, and not while a scheduled retry is still on time:
 * pressing Retry then would race the robot to the tradie's inbox.
 */
export function canRetryRequestEmail(
  state: RequestDeliveryState,
  now: Date,
): boolean {
  if (state.deliveryStatus === TradieRequestDeliveryStatus.FAILED) return true;
  if (
    state.deliveryStatus === TradieRequestDeliveryStatus.RETRYING
    && state.nextAttemptAt
  ) {
    return (
      new Date(state.nextAttemptAt).getTime() + OVERDUE_RETRY_GRACE_MS
      <= now.getTime()
    );
  }
  return false;
}

/** Needs a person: failed, or a retry that should have happened by now. */
export function requestEmailNeedsAttention(
  state: RequestDeliveryState,
  now: Date,
): boolean {
  return canRetryRequestEmail(state, now);
}
