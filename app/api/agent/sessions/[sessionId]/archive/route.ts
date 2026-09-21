import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sessionId } = await params;
  const owner = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await prisma.agentSession.updateMany({
    where: {
      eveSessionId: sessionId,
      ownerUserId: owner.id,
      parentEveSessionId: null,
      archivedAt: null,
    },
    data: { archivedAt: new Date(), status: "ARCHIVED" },
  });
  if (result.count !== 1) {
    const archived = await prisma.agentSession.findFirst({
      where: {
        eveSessionId: sessionId,
        ownerUserId: owner.id,
        parentEveSessionId: null,
        archivedAt: { not: null },
      },
      select: { id: true },
    });
    if (!archived)
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ archived: true });
}
