import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { describeOutreachAttachments } from "@/lib/domain/agent/approval-targets";
import { principalForClerkId } from "@/lib/domain/identity/users";

/**
 * The file names an outreach approval will attach, so the card shows the email
 * that goes out rather than only the arguments the model wrote (#366).
 *
 * A signed-in application user only, for the reason the approval-targets route
 * gives. `attachments` is null when the input is not an outreach or the caller
 * may not open the project; the card then says it could not check.
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
    return NextResponse.json({ attachments: null });

  const attachments = await describeOutreachAttachments(
    principal,
    input as Record<string, unknown>,
    prisma,
  );
  return NextResponse.json({ attachments });
}
