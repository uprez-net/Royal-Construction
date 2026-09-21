import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";

const annotationSchema = z
  .object({
    type: z.string().min(1).max(32),
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(240),
    href: z.string().max(2_000),
    group: z.string().max(80),
  })
  .strict();

const contextSchema = z
  .object({
    turnId: z.string().min(1).max(200),
    annotations: z.array(annotationSchema).max(20),
  })
  .strict();

type PersistedContext = {
  annotationsByTurn?: Record<string, unknown>;
  [key: string]: unknown;
};

function asContext(value: unknown): PersistedContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as PersistedContext;
}

export async function POST(
  request: Request,
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

  const parsed = contextSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid session context" },
      { status: 400 },
    );
  }

  const { sessionId } = await params;
  const session = await prisma.agentSession.findFirst({
    where: {
      eveSessionId: sessionId,
      ownerUserId: actor.id,
      parentEveSessionId: null,
    },
    select: { id: true, selectedContext: true },
  });
  if (!session) {
    return NextResponse.json(
      { error: "Agent session not found" },
      { status: 404 },
    );
  }

  const current = asContext(session.selectedContext);
  const annotationsByTurn = {
    ...(current.annotationsByTurn ?? {}),
    [parsed.data.turnId]: parsed.data.annotations,
  };
  const persistedTurnIds = Object.keys(annotationsByTurn);
  for (const oldTurnId of persistedTurnIds.slice(0, -100)) {
    delete annotationsByTurn[oldTurnId];
  }
  await prisma.agentSession.update({
    where: { id: session.id },
    data: {
      selectedContext: JSON.parse(
        JSON.stringify({ ...current, annotationsByTurn }),
      ),
    },
  });

  return NextResponse.json({ persisted: true });
}
