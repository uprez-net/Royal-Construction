import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";

import { clerkClient } from "@/lib/auth";
import {
  errorResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * Every device signed in to the caller's account (GET).
 *
 * Read from Clerk's backend API rather than the browser's
 * `user.getSessions()`, which keeps its first answer for the life of the page
 * and answers a failed request with an empty list: the screen showed "no
 * devices" instead of an error, and "Try again" asked nobody. Here a failure
 * is a 502 the section shows, and every load is a fresh read.
 */

const SESSION_PAGE_SIZE = 100;

type AccountDeviceSession = {
  readonly id: string;
  readonly current: boolean;
  /** Epoch milliseconds. */
  readonly lastActiveAt: number;
  readonly browserName: string | null;
  readonly browserVersion: string | null;
  readonly deviceType: string | null;
  readonly isMobile: boolean;
  readonly city: string | null;
  readonly country: string | null;
  readonly ipAddress: string | null;
};

export async function GET() {
  await connection();
  const { userId, sessionId } = await auth();
  if (!userId) return unauthorizedResponse();

  try {
    // Every page: "Sign out all others" acts on this list, and a device left
    // off it would stay signed in without anyone seeing it.
    const data = [];
    for (let offset = 0; ; offset += SESSION_PAGE_SIZE) {
      const page = await clerkClient.sessions.getSessionList({
        limit: SESSION_PAGE_SIZE,
        offset,
        status: "active",
        userId,
      });
      data.push(...page.data);
      if (
        page.data.length < SESSION_PAGE_SIZE
        || data.length >= page.totalCount
      ) {
        break;
      }
    }
    const sessions: AccountDeviceSession[] = data
      .map((session) => ({
        browserName: session.latestActivity?.browserName ?? null,
        browserVersion: session.latestActivity?.browserVersion ?? null,
        city: session.latestActivity?.city ?? null,
        country: session.latestActivity?.country ?? null,
        current: session.id === sessionId,
        deviceType: session.latestActivity?.deviceType ?? null,
        id: session.id,
        ipAddress: session.latestActivity?.ipAddress ?? null,
        isMobile: session.latestActivity?.isMobile ?? false,
        lastActiveAt: session.lastActiveAt,
      }))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return successResponse(sessions);
  } catch (error) {
    console.error("[account] Listing the signed-in devices failed", error);
    return errorResponse("Could not load your devices.", {
      code: "ACCOUNT_SESSIONS_LOAD_FAILED",
      status: 502,
    });
  }
}
