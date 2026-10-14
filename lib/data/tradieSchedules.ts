"use server";

import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { TradieScheduleStatus } from "@prisma/client";
import type {
  CreateTradieScheduleInput,
  UpdateTradieScheduleInput,
} from "@/utils/validators";
import { CACHE_PROFILES } from "@/types/cache";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { triggerNotification } from "../notification/novu";
import { createNotification } from "@/types/notification";
import { currency, dateFormat } from "@/utils/formatters";
import { after } from "next/server";
import { TradieScheduleListItem } from "@/types/project";
import { auth } from "@clerk/nextjs/server";
import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { getAllAdminUsersIds, getUserByClerkIdCached } from "./user";
import { authorizeProject } from "@/lib/domain/access/projects";
import {
  createTradieSchedule as createTradieScheduleDomain,
  createTradieSchedules as createTradieSchedulesDomain,
  listTradieBookings,
  type TradieBooking,
  requestTradieScheduleDeletion as requestTradieScheduleDeletionDomain,
  rescheduleTradieSchedule as rescheduleTradieScheduleDomain,
} from "@/lib/domain/tradies/schedules";
import { sendTradieScheduleReminder as sendTradieScheduleReminderDomain } from "@/lib/domain/tradies/reminders";
import { DomainNotFoundError, isDomainError } from "@/lib/domain/errors";
import {
  domainActionFailure,
  type DomainActionFailure,
} from "@/lib/http/domain-response";
import { userPrincipal, type DomainPrincipal } from "@/lib/domain/principal";
import { generateTradieOutreachEmail } from "@/utils/generate-email";
import { sendEmail } from "../azureClient";
import { DeleteScheduleInput } from "@/types/tradie";
import { createActivityLogEntry } from "@/types/activityLog";
import {
  applyTradieScheduleUpdate,
  convertToTradieScheduleListItem,
} from "./tradie-schedule-updates";
import { logAction } from "./actionLog";
import { scheduleTotalCost } from "@/utils/calculations";
import { get } from "@vercel/blob";

/**
 * Ensures the currently authenticated user is the site manager of the
 * specified project before allowing schedule operations.
 *
 * @param projectId - The project whose schedule access should be validated.
 * @throws {Error} If the user is not authenticated.
 * @throws {Error} If the user cannot be found.
 * @throws {Error} If the project does not exist.
 * @throws {Error} If the authenticated user is not the project's site manager.
 */
// ADMIN, or the project's own site manager. The rule is
// lib/domain/access/projects.ts#canManageProject, which Eve's schedule tools
// call too — this used to be one of three separate spellings of it. The
// messages are unchanged, and the unused siteManager join went with the old
// query.
const userHasAccessToSchedule = async (projectId: string) => {
  const { userId } = await auth();
  if (!userId) {
    throw new Error("User not authenticated");
  }
  const user = await getUserByClerkIdCached(userId);
  if (!user) {
    throw new Error("User not found");
  }
  try {
    await authorizeProject(userPrincipal(user), projectId, prisma);
  } catch (error) {
    if (error instanceof DomainNotFoundError) {
      throw new Error("Project not found");
    }
    if (isDomainError(error)) {
      throw new Error("User does not have access to this schedule");
    }
    throw error;
  }

  // The whole user, not just the id: callers that go on to invoke a domain
  // command need a real principal, and inventing a role for one would make the
  // command's own authorization meaningless.
  return user;
};

/**
 * Creates a new tradie schedule for a project.
 *
 * The schedule is created with a default status of `PENDING`. After creation,
 * relevant cache tags are revalidated and a notification is sent to the
 * project's site manager.
 *
 * @param input - The schedule creation payload.
 * @returns The newly created schedule formatted as a {@link TradieScheduleListItem}.
 * @throws {Error} If the user does not have permission to create schedules
 * for the project or if the schedule cannot be created.
 */
export async function createTradieSchedule(input: CreateTradieScheduleInput) {
  try {
    const actingUser = await userHasAccessToSchedule(input.projectId);
    // The create itself is lib/domain/tradies/schedules.ts, shared with Eve's
    // booking tool: the milestone must belong to the project, and the tradie
    // must not already hold an active booking on the same project and
    // milestone. Overlapping days on different work are allowed.
    const created = await createTradieScheduleDomain(
      userPrincipal(actingUser),
      {
        durationDays: input.durationDays ?? 1,
        milestoneId: input.milestoneId ?? null,
        projectId: input.projectId,
        requiresQuote: input.requiresQuote ?? false,
        scheduledDate: new Date(input.scheduledDate),
        tradieId: input.tradieId,
      },
      prisma,
    );
    const schedule = await prisma.tradieSchedule.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });
    const result = convertToTradieScheduleListItem(schedule);

    after(async () => {
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      revalidateTag(`project-${schedule.projectId}`, CACHE_PROFILES.MEDIUM);
      const siteManagerId = schedule.project.siteManagerId;
      const notificationPayload = createNotification("tradieScheduleCreated", {
        tradieName: schedule.tradie.name,
        projectName: schedule.project.name,
        milestoneName: schedule.milestone
          ? schedule.milestone.name
          : "General Task",
        projectId: schedule.projectId,
        tradieTrade: schedule.tradie.trade,
        scheduleDate: dateFormat.format(schedule.scheduledDate),
      });
      const activityLogEntry = createActivityLogEntry("tradieScheduleCreated", {
        projectId: schedule.projectId,
        scheduleId: schedule.id,
        tradieId: schedule.tradieId,
        tradieName: schedule.tradie.name,
        trade: schedule.tradie.trade,
        scheduleDate: dateFormat.format(schedule.scheduledDate),
        durationDays: schedule.durationDays,
        cost:
          schedule.quotedPrice
          ?? currency.format(
            scheduleTotalCost(
              parseFloat(schedule.tradie.lastQuotedPrice?.toString() ?? "0"),
              schedule.durationDays,
              schedule.tradie.lastQuotedPriceUnit,
            ),
          ),
        milestoneId: schedule.milestoneId ?? undefined,
        milestoneName: schedule.milestone
          ? schedule.milestone.name
          : "General Task",
      });
      await logAction(activityLogEntry);
      await triggerNotification(
        siteManagerId ? [siteManagerId] : [],
        notificationPayload,
      );
      const emailContent = generateTradieOutreachEmail(result);
      await sendEmail({
        to: schedule.tradie.email,
        subject: emailContent.subject,
        body: emailContent.html,
      });
    });

    return result;
  } catch (error) {
    console.error("Error creating tradie schedule:", error);
    // A refusal keeps its own status and sentence for the route to answer with.
    if (isDomainError(error)) throw error;
    throw new Error("Failed to create tradie schedule.");
  }
}

/**
 * Creates multiple tradie schedules in a single operation.
 *
 * All schedules are created with a default status of `PENDING`. After
 * successful creation, cache tags are revalidated and notifications are
 * sent for each created schedule.
 *
 * @param inputs - An array of schedule creation payloads.
 * A domain refusal — the same booking twice, a milestone on another project,
 * no access — is **returned**, not thrown. This is a Server Action, and in
 * production Next replaces a thrown message with an opaque digest, so the
 * office saw "Failed to bulk create tradie schedules." for a refusal the
 * domain had already named.
 *
 * @returns The formatted {@link TradieScheduleListItem} objects, or the refusal.
 * @throws {Error} If the operation fails for a reason that is not a refusal.
 */
export async function bulkCreateTradieSchedules(
  inputs: CreateTradieScheduleInput[],
): Promise<
  { ok: true; schedules: TradieScheduleListItem[] } | DomainActionFailure
> {
  try {
    if (inputs.length === 0) {
      throw new Error("No inputs provided for bulk creation.");
    }
    const projectId = inputs[0].projectId;
    const actingUser = await userHasAccessToSchedule(projectId);
    const created = await createTradieSchedulesDomain(
      userPrincipal(actingUser),
      inputs.map((input) => ({
        durationDays: input.durationDays ?? 1,
        milestoneId: input.milestoneId ?? null,
        projectId: input.projectId,
        requiresQuote: input.requiresQuote ?? false,
        scheduledDate: new Date(input.scheduledDate),
        tradieId: input.tradieId,
      })),
      prisma,
    );
    const stored = await prisma.tradieSchedule.findMany({
      where: { id: { in: created.map((schedule) => schedule.id) } },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });
    const storedById = new Map(
      stored.map((schedule) => [schedule.id, schedule]),
    );
    const schedules = created.map((schedule) => {
      const storedSchedule = storedById.get(schedule.id);
      if (!storedSchedule)
        throw new Error("Schedule not found after creation.");
      return storedSchedule;
    });

    after(async () => {
      const projectIds = Array.from(
        new Set(schedules.map((schedule) => schedule.projectId)),
      );
      revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
      revalidateTag("projects", CACHE_PROFILES.MEDIUM);
      for (const projectId of projectIds) {
        revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);
      }
      for (const schedule of schedules) {
        const siteManagerId = schedule.project.siteManagerId;
        const notificationPayload = createNotification(
          "tradieScheduleCreated",
          {
            tradieName: schedule.tradie.name,
            projectName: schedule.project.name,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
            projectId: schedule.projectId,
            tradieTrade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
          },
        );
        const activityLogEntry = createActivityLogEntry(
          "tradieScheduleCreated",
          {
            projectId: schedule.projectId,
            scheduleId: schedule.id,
            tradieId: schedule.tradieId,
            tradieName: schedule.tradie.name,
            trade: schedule.tradie.trade,
            scheduleDate: dateFormat.format(schedule.scheduledDate),
            durationDays: schedule.durationDays,
            cost:
              schedule.quotedPrice
              ?? currency.format(
                scheduleTotalCost(
                  parseFloat(
                    schedule.tradie.lastQuotedPrice?.toString() ?? "0",
                  ),
                  schedule.durationDays,
                  schedule.tradie.lastQuotedPriceUnit,
                ),
              ),
            milestoneId: schedule.milestoneId ?? undefined,
            milestoneName: schedule.milestone
              ? schedule.milestone.name
              : "General Task",
          },
        );
        await logAction(activityLogEntry);
        await triggerNotification(
          siteManagerId ? [siteManagerId] : [],
          notificationPayload,
        );
        const emailContent = inputs.find(
          (input) => input.tradieId === schedule.tradieId,
        )!.emailContent;
        if (!emailContent) continue;
        const attachments: { name: string; contentBytes: string }[] = [];
        for (const attachment of emailContent.attachments) {
          const blob = await get(attachment.url, { access: "public" });

          if (!blob?.stream) continue;

          const reader = blob.stream.getReader();
          const chunks: Uint8Array[] = [];

          while (true) {
            const { done, value } = await reader.read();

            if (done) break;
            if (value) chunks.push(value);
          }

          const buffer = Buffer.concat(
            chunks.map((chunk) => Buffer.from(chunk)),
          );

          attachments.push({
            name: attachment.name,
            contentBytes: buffer.toString("base64"),
          });
        }
        await sendEmail({
          to: schedule.tradie.email,
          subject: emailContent.subject,
          body: emailContent.body,
          cc:
            schedule.tradie.additionalEmails.length > 0
              ? schedule.tradie.additionalEmails
              : undefined,
          attachments:
            attachments.length > 0
              ? attachments.map((att) => ({
                  name: att.name,
                  contentBytes: att.contentBytes,
                }))
              : undefined,
        });
      }
    });

    return {
      ok: true,
      schedules: schedules.map(convertToTradieScheduleListItem),
    };
  } catch (error) {
    const refused = domainActionFailure(error);
    if (refused) return refused;
    console.error("Error bulk creating tradie schedules:", error);
    throw new Error("Failed to bulk create tradie schedules.");
  }
}

/**
 * Updates the status of an existing tradie schedule as the signed-in user.
 *
 * The Server Action half: it resolves who is asking and hands over to
 * `applyTradieScheduleUpdate`, which owns the transition and its effects.
 *
 * @throws {Error} If the schedule does not exist, the user may not manage its
 * project, or the update fails.
 */
export async function updateTradieSchedule(
  scheduleId: string,
  updates: UpdateTradieScheduleInput,
  options: {
    statusAlreadyApplied?: boolean;
    /** The status actually committed, when the caller wants another's effects. */
    appliedStatus?: TradieScheduleStatus;
    approvalId?: string;
  } = {},
) {
  let actingUser: Awaited<ReturnType<typeof userHasAccessToSchedule>>;
  try {
    const existingSchedule = await prisma.tradieSchedule.findUnique({
      select: { projectId: true },
      where: { id: scheduleId },
    });
    if (!existingSchedule) throw new Error("Schedule not found");
    actingUser = await userHasAccessToSchedule(existingSchedule.projectId);
  } catch (error) {
    console.error("Error updating tradie schedule:", error);
    throw new Error("Failed to update tradie schedule.");
  }
  return applyTradieScheduleUpdate(
    userPrincipal(actingUser),
    scheduleId,
    updates,
    options,
  );
}

/**
 * Raises an admin approval request to remove a booked tradie schedule.
 *
 * Removal is never immediate. A booking that has been sent to a tradie — and
 * in most cases confirmed by them — represents a commitment the site manager
 * cannot quietly withdraw, so the request is recorded as a
 * `SCHEDULE_DELETION` approval and every admin is notified. The schedule row
 * is only deleted once an admin approves, in {@link handleAdminApproval}.
 *
 * @param input - The schedule to remove and the reason an admin will judge.
 * @returns Whether the request was raised, with a message for the caller and
 * the id of the approval when one was created.
 */
export async function requestTradieScheduleDeletion(
  input: DeleteScheduleInput,
) {
  try {
    const schedule = await prisma.tradieSchedule.findUnique({
      where: { id: input.scheduleId },
      include: {
        tradie: true,
        project: { include: { siteManager: true } },
        milestone: true,
      },
    });
    if (!schedule) {
      throw new Error("Schedule not found");
    }
    const actingUser = await userHasAccessToSchedule(schedule.projectId);
    const requested = await requestTradieScheduleDeletionDomain(
      userPrincipal(actingUser),
      input,
      prisma,
    );

    const totalCost = scheduleTotalCost(
      parseFloat(schedule.tradie.lastQuotedPrice?.toString() ?? "0"),
      schedule.durationDays,
      schedule.tradie.lastQuotedPriceUnit,
    );
    const cost = currency.format(
      schedule.quotedPrice ? parseFloat(schedule.quotedPrice) : totalCost,
    );
    const scheduledDate = dateFormat.format(schedule.scheduledDate);
    const milestoneName = schedule.milestone
      ? schedule.milestone.name
      : "General Task";

    after(async () => {
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
      revalidateTag(`approval-kpi`, CACHE_PROFILES.MEDIUM);
      const requester = await prisma.user.findUnique({
        where: { id: actingUser.id },
        select: { name: true },
      });
      const notificationPayload = createNotification(
        "tradieScheduleDeletionRequest",
        {
          approvalId: requested.approvalId,
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          projectName: schedule.project.name,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName,
          scheduledDate,
          durationDays: schedule.durationDays,
          cost,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          reason: input.reason,
          requestedBy: requester?.name ?? "A site manager",
        },
      );
      const activityLogEntry = createActivityLogEntry(
        "tradieScheduleDeletionRequested",
        {
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          tradieId: schedule.tradieId,
          tradieName: schedule.tradie.name,
          trade: schedule.tradie.trade,
          scheduleDate: scheduledDate,
          durationDays: schedule.durationDays,
          cost,
          milestoneId: schedule.milestoneId ?? undefined,
          milestoneName,
          reason: input.reason,
        },
      );
      await logAction(activityLogEntry);
      // Guarded because triggerNotification reads an empty recipient list as
      // "broadcast to every user" — a request meant for admins must not reach
      // the whole company if none are configured.
      const adminIds = await getAllAdminUsersIds();
      if (adminIds.length > 0) {
        await triggerNotification(adminIds, notificationPayload);
      }
    });

    return {
      success: true,
      message: "Deletion request submitted for admin approval.",
      approvalId: requested.approvalId,
    };
  } catch (error) {
    console.error("Error requesting tradie schedule deletion:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to request schedule deletion.",
    };
  }
}

/**
 * Sends a reminder email to the tradie booked on a schedule.
 *
 * Staff only, and always to that schedule's tradie. This used to take the
 * recipient from the browser and check nobody, so any signed-in user could
 * send any subject and body to any address from Royal's mailbox.
 *
 * @param scheduleId - The schedule whose tradie is reminded.
 * @param subject - The subject of the reminder email.
 * @param body - The body content of the reminder email.
 * @returns `success: false` with a message for a refusal or a tradie with no email.
 * @throws {Error} If the email sending operation fails.
 */
export async function sendTradieScheduleReminder({
  scheduleId,
  subject,
  body,
}: {
  scheduleId: string;
  subject: string;
  body: string;
}) {
  const access = await requireInternalUser();
  if (!access.ok) {
    return { success: false, message: access.error };
  }

  try {
    const idempotencyKey = createHash("sha256")
      .update(`${scheduleId}\0${subject}\0${body}`)
      .digest("hex");
    const sent = await sendTradieScheduleReminderDomain(
      userPrincipal(access.user),
      { body, idempotencyKey, scheduleId, subject },
      prisma,
      (input) => sendEmail(input),
    );

    // Say which it was. Reporting a deduplicated replay as a fresh send is how
    // the office ends up believing a tradie was reminded when nothing left the
    // mailbox.
    return sent.alreadySent
      ? {
          success: true,
          message:
            "This exact reminder already went out today; nothing was sent again.",
        }
      : { success: true, message: "Reminder sent successfully." };
  } catch (error) {
    if (isDomainError(error)) {
      return { success: false, message: error.message };
    }
    console.error("Error sending tradie schedule reminder:", error);
    throw new Error("Failed to send tradie schedule reminder.");
  }
}

export type RescheduleTradieScheduleResult =
  | {
      readonly ok: true;
      readonly status: TradieScheduleStatus;
      readonly scheduledDate: string;
      readonly durationDays: number;
      /** A pending approval for the old date was withdrawn. */
      readonly withdrewApproval: boolean;
      /**
       * What happened to the tradie's email. `failed` is still `ok: true`:
       * the booking did move, and the dialog has to say both things.
       */
      readonly email: "sent" | "already-sent" | "not-sent" | "failed";
      readonly emailError?: string;
    }
  | DomainActionFailure
  | { readonly ok: false; readonly error: string };

const BOOKING_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Move a booking to new dates, then email its tradie about it.
 *
 * The status the booking lands in, and therefore which email it needs, is
 * `rescheduleTradieSchedule`'s decision; the dialog previews the same one from
 * `rescheduleOutcome` and sends `expectedStatus` so a reply landing in between
 * is refused rather than answered with the wrong email.
 *
 * The move commits first and the email follows. A failed email does not undo
 * the move — the date is what the office decided — but it is reported, in the
 * result and in the activity log, because a booking quietly moved under a
 * tradie who was never told is the failure nobody sees until the day.
 *
 * @param idempotencyKey Held by the dialog until a send succeeds, so a retry
 * after a timeout lands on the same email rather than a second one.
 */
export async function rescheduleTradieScheduleAction(input: {
  scheduleId: string;
  scheduledDate: string;
  durationDays: number;
  expectedStatus: TradieScheduleStatus;
  email: { subject: string; body: string } | null;
  idempotencyKey: string;
}): Promise<RescheduleTradieScheduleResult> {
  const access = await requireInternalUser();
  if (!access.ok) return { ok: false, error: access.error };

  if (
    !BOOKING_DAY.test(input.scheduledDate)
    || !Number.isInteger(input.durationDays)
    || input.durationDays < 1
    || input.durationDays > 365
  ) {
    return { ok: false, error: "Pick a valid date and duration." };
  }
  if (
    input.email
    && (!input.email.subject.trim() || !input.email.body.trim())
  ) {
    return { ok: false, error: "The email needs a subject and a body." };
  }
  if (!input.idempotencyKey.trim()) {
    return { ok: false, error: "Missing request key; reopen the dialog." };
  }

  const principal = userPrincipal(access.user);
  let moved: Awaited<ReturnType<typeof rescheduleTradieScheduleDomain>>;
  try {
    moved = await rescheduleTradieScheduleDomain(
      principal,
      {
        durationDays: input.durationDays,
        expectedStatus: input.expectedStatus,
        scheduleId: input.scheduleId,
        scheduledDate: new Date(`${input.scheduledDate}T00:00:00.000Z`),
      },
      prisma,
    );
  } catch (error) {
    const refused = domainActionFailure(error);
    if (refused) return refused;
    console.error("Error rescheduling tradie schedule:", error);
    return { ok: false, error: "Could not reschedule this booking." };
  }

  let email: "sent" | "already-sent" | "not-sent" | "failed" = "not-sent";
  let emailError: string | undefined;
  if (moved.notice && input.email) {
    try {
      const sent = await sendTradieScheduleReminderDomain(
        principal,
        {
          body: input.email.body,
          // Scoped to the move as well as the attempt: moving the same
          // booking twice in a day is two emails, not one.
          idempotencyKey: `reschedule:${moved.scheduleId}:${input.scheduledDate}:${moved.durationDays}:${input.idempotencyKey}`,
          scheduleId: moved.scheduleId,
          subject: input.email.subject,
        },
        prisma,
        (message) => sendEmail(message),
      );
      email = sent.alreadySent ? "already-sent" : "sent";
    } catch (error) {
      email = "failed";
      emailError = isDomainError(error)
        ? error.message
        : "The email provider did not accept the message.";
      console.error("Error emailing rescheduled tradie:", error);
    }
  }

  after(async () => {
    revalidateTag("tradies-schedules", CACHE_PROFILES.SHORT);
    revalidateTag("projects", CACHE_PROFILES.MEDIUM);
    revalidateTag(`project-${moved.projectId}`, CACHE_PROFILES.MEDIUM);
    if (moved.withdrewApproval) {
      revalidateTag("approval-query", CACHE_PROFILES.MEDIUM);
      revalidateTag("approval-kpi", CACHE_PROFILES.MEDIUM);
    }
    await logAction(
      createActivityLogEntry("tradieScheduleRescheduled", {
        durationDays: moved.durationDays,
        milestoneId: moved.milestoneId ?? undefined,
        notice:
          email === "sent" || email === "already-sent"
            ? "emailed"
            : email === "failed"
              ? "email-failed"
              : "not-emailed",
        previousDate: dateFormat.format(moved.previousScheduledDate),
        projectId: moved.projectId,
        scheduleDate: dateFormat.format(moved.scheduledDate),
        scheduleId: moved.scheduleId,
        tradieName: moved.tradieName,
      }),
    );
  });

  return {
    durationDays: moved.durationDays,
    email,
    ...(emailError ? { emailError } : {}),
    ok: true,
    scheduledDate: moved.scheduledDate.toISOString(),
    status: moved.status,
    withdrewApproval: moved.withdrewApproval,
  };
}

async function cachedTradieBookings(
  principal: DomainPrincipal,
  tradieId: string,
  fromDay: string,
) {
  "use cache";
  // Every booking write in the app revalidates this tag. Eve's cannot, so a
  // booking it makes can show as free here for up to the profile's lifetime —
  // only a marker is missing; the booking command still refuses a duplicate.
  cacheTag("tradies-schedules");
  cacheLife(CACHE_PROFILES.SHORT);

  return listTradieBookings(
    principal,
    { from: new Date(`${fromDay}T00:00:00.000Z`), tradieId },
    prisma,
  );
}

/**
 * The bookings holding a tradie's time from today on, for the schedule modal
 * to grey out those days and say what the tradie is booked on.
 */
export async function getTradieBookings(
  tradieId: string,
): Promise<
  | { ok: true; bookings: TradieBooking[] }
  | DomainActionFailure
  | { ok: false; error: string }
> {
  const access = await requireInternalUser();
  if (!access.ok) return { ok: false, error: access.error };

  try {
    const today = new Date().toISOString().slice(0, 10);
    const bookings = await cachedTradieBookings(
      userPrincipal(access.user),
      tradieId,
      today,
    );
    return { ok: true, bookings };
  } catch (error) {
    const refused = domainActionFailure(error);
    if (refused) return refused;
    console.error("Error loading tradie bookings:", error);
    return { ok: false, error: "Could not load this tradie's bookings." };
  }
}
