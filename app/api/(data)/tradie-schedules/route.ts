import { TradieScheduleStatus } from "@prisma/client";

import prisma from "@/lib/prisma";

export async function POST(request: Request) {

  const body = (await request.json()) as {
    tradieId?: string;
    projectId?: string;
    milestoneId?: string;
    scheduledDate?: string;
    durationDays?: number;
  };

  if (!body.tradieId || !body.projectId || !body.scheduledDate) {
    return new Response("Invalid schedule payload", { status: 400 });
  }

  const schedule = await prisma.tradieSchedule.create({
    data: {
      tradieId: body.tradieId,
      projectId: body.projectId,
      milestoneId: body.milestoneId || null,
      scheduledDate: new Date(body.scheduledDate),
      durationDays: body.durationDays ?? 1,
      status: TradieScheduleStatus.PENDING,
    },
    include: {
      tradie: true,
      project: true,
      milestone: true,
    },
  });

  return Response.json(schedule);
}
