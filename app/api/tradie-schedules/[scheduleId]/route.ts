import { auth } from "@clerk/nextjs/server";
import { TradieScheduleStatus } from "@prisma/client";

import prisma from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: { scheduleId: string } },
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as { status?: TradieScheduleStatus };

  if (!body.status) {
    return new Response("Status is required", { status: 400 });
  }

  const requiresReplacement = body.status === TradieScheduleStatus.DECLINED;

  const schedule = await prisma.tradieSchedule.update({
    where: { id: params.scheduleId },
    data: {
      status: body.status,
    },
    include: {
      tradie: true,
      project: true,
      milestone: true,
    },
  });

  return Response.json({
    schedule,
    requiresReplacement,
  });
}
