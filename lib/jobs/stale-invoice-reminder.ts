import { findAdminUserIds } from "@/lib/domain/identity/users";
import { nudgeStaleInvoices } from "@/lib/domain/tradies/invoice-inbox";
import { triggerNotification } from "@/lib/notification/novu";
import prisma from "@/lib/prisma";
import { createNotification } from "@/types/notification";

/**
 * Daily: tell the office about emailed tradie invoices nobody has confirmed.
 * Internal only; nothing is emailed or recorded.
 */
export function remindStaleInvoices(
  now: Date = new Date(),
): Promise<{ failed: number; reminded: number }> {
  return nudgeStaleInvoices(prisma, now, {
    // An empty list means everyone to Novu, so the domain never passes one.
    adminIds: () => findAdminUserIds(prisma),
    // triggerNotification does not throw: it answers { success: false }, so
    // that is what a failed nudge looks like (#588).
    notify: async (admins, entry) => {
      const result = await triggerNotification(
        [...admins],
        createNotification("tradieInvoiceWaiting", {
          count: entry.count,
          days: entry.oldestDays,
          projectId: entry.projectId,
          projectName: entry.projectName,
        }),
      );
      if (!result.success) {
        console.error(
          `[stale-invoices] could not notify for project ${entry.projectId}`,
        );
      }
      return result.success;
    },
  });
}
