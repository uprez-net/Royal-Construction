import { TradieScheduleStatus } from "@prisma/client";

import prisma from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const { scheduleId } = await params;

  const body = (await request.json()) as { status?: TradieScheduleStatus };

  if (!body.status) {
    return new Response("Status is required", { status: 400 });
  }

  const requiresReplacement = body.status === TradieScheduleStatus.DECLINED;

  const schedule = await prisma.tradieSchedule.update({
    where: { id: scheduleId },
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
