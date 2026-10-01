import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { describeApprovalTargets } from "@/lib/domain/agent/approval-targets";
import { principalForClerkId } from "@/lib/domain/identity/users";

/**
 * Names for the ids in a pending approval, so the approval card can say which
 * milestone, tradie or project it changes rather than showing bare UUIDs.
 *
 * A signed-in application user only: `currentPrincipal()` would answer a
 * request with no session as the system principal, which sees everything.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const principal = await principalForClerkId(userId, prisma);
  if (!principal)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    input?: unknown;
  } | null;
  const input = body?.input;
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return NextResponse.json({ labels: {} });

  const labels = await describeApprovalTargets(
    principal,
    input as Record<string, unknown>,
    prisma,
  );
  return NextResponse.json({ labels });
}
