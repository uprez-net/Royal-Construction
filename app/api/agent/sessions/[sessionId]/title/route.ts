import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";

/**
 * The generated title of one of the caller's own conversations.
 *
 * The title is written a few seconds after the first message, off the request
 * path, so the sidebar read "New conversation" until the page was reloaded
 * (#432). The workspace asks here once a turn settles. Owner-scoped like the
 * context route beside it: another person's session is simply not found.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getUserByClerkIdCached(userId);
  if (!actor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sessionId } = await params;
  const session = await prisma.agentSession.findFirst({
    select: { title: true },
    where: {
      eveSessionId: sessionId,
      ownerUserId: actor.id,
      parentEveSessionId: null,
    },
  });
  if (!session) {
    return NextResponse.json(
      { error: "Agent session not found" },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { title: session.title },
    { headers: { "cache-control": "no-store" } },
  );
}
