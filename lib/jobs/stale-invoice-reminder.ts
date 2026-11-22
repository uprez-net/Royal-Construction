import { findAdminUserIds } from "@/lib/domain/identity/users";
import { staleInvoiceReminders } from "@/lib/domain/tradies/invoice-inbox";
import { triggerNotification } from "@/lib/notification/novu";
import prisma from "@/lib/prisma";
import { createNotification } from "@/types/notification";

/**
 * Daily: tell the office about emailed tradie invoices nobody has confirmed.
 * Internal only; nothing is emailed or recorded.
 */
export async function remindStaleInvoices(
  now: Date = new Date(),
): Promise<{ failed: number; reminded: number }> {
  const due = await staleInvoiceReminders(prisma, now);
  if (due.length === 0) return { failed: 0, reminded: 0 };

  // An empty list means everyone to Novu; with no admins, tell nobody.
  const admins = await findAdminUserIds(prisma);
  if (admins.length === 0) return { failed: 0, reminded: 0 };

  let failed = 0;
  for (const entry of due) {
    // triggerNotification does not throw: it answers { success: false }, so
    // that is what a failed nudge looks like (#588).
    const result = await triggerNotification(
      admins,
      createNotification("tradieInvoiceWaiting", {
        count: entry.count,
        days: entry.oldestDays,
        projectId: entry.projectId,
        projectName: entry.projectName,
      }),
    ).catch(() => ({ success: false as const }));
    if (!result.success) {
      failed += 1;
      console.error(
        `[stale-invoices] could not notify for project ${entry.projectId}`,
      );
    }
  }
  return { failed, reminded: due.length - failed };
}
