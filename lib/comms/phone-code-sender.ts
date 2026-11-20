import type { PhoneCodeSender } from "@/lib/domain/identity/phone-verification";

import { commsRuntimeFromEnv, type CommsRuntime } from "./factory";

/**
 * Where a phone verification code is texted from: Royal's Telnyx number.
 *
 * Telnyx even while another carrier is the active provider for lead texts. The
 * code is not a conversation with a customer, so it does not need to come from
 * the number the office texts leads on, and nothing replies to it.
 * COMMS_SMS_ENABLED still applies: with texting switched off the Telnyx
 * adapter has no SMS port, and the command refuses with a reason rather than
 * pretending a code went.
 */
export function phoneCodeSender(
  runtime: CommsRuntime = commsRuntimeFromEnv(),
): PhoneCodeSender {
  const number = runtime.config.numbers.find(
    (candidate) => candidate.provider === "telnyx",
  );
  if (!number) return { from: null, sms: null };
  return { from: number.e164, sms: runtime.adapterFor("telnyx").sms };
}
