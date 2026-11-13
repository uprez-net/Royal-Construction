import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
  forbiddenResponse,
  notFoundResponse,
  successResponse,
  unauthorizedResponse,
} from "@/utils/validators/response";

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
    return unauthorizedResponse();
  }
  const actor = await getUserByClerkIdCached(userId);
  if (!actor) {
    return forbiddenResponse();
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
    return notFoundResponse("Agent session");
  }
  const response = successResponse({ title: session.title });
  response.headers.set("cache-control", "no-store");
  return response;
}
