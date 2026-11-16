"use client";

import type { LeadCommsUnreadDto } from "@/lib/leads/comms-types";

/** "1 call Mili took and 2 unread texts", or null when nothing is unread. */
export function commsUnreadSummary(
  unread: LeadCommsUnreadDto | undefined,
): string | null {
  if (!unread || unread.calls + unread.sms === 0) return null;
  const parts: string[] = [];
  if (unread.calls > 0) {
    parts.push(
      `${unread.calls} new call${unread.calls === 1 ? "" : "s"} taken by Mili or voicemail`,
    );
  }
  if (unread.sms > 0) {
    parts.push(`${unread.sms} unread text${unread.sms === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}

/**
 * The count over a lead's call icon: calls Mili or the voicemail took and
 * texts nobody has opened. Opening the Phone & SMS window clears it.
 */
export function CommsUnreadBadge({
  unread,
}: {
  unread: LeadCommsUnreadDto | undefined;
}) {
  const total = unread ? unread.calls + unread.sms : 0;
  if (total === 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
      aria-hidden="true"
    >
      {total > 9 ? "9+" : total}
    </span>
  );
}
