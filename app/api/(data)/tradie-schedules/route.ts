import { TradieScheduleStatus } from "@prisma/client";
import { getCachedTradieCoordinationDashboard, getCachedTradies } from "@/lib/data/tradies";
import { TradieCoordinationSortBy, TradieCoordinationTab } from "@/types/project";
import { NextResponse } from "next/server";
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "coordination") {
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
    const search = url.searchParams.get("search") ?? "";
    const projectId = url.searchParams.get("projectId");
    const tradeType = url.searchParams.get("tradeType");
    const statusParam = url.searchParams.get("status");
    const tabParam = url.searchParams.get("tab");
    const sortByParam = url.searchParams.get("sortBy");
    const sortOrder = url.searchParams.get("sortOrder") === "desc" ? "desc" : "asc";

    const status = statusParam && Object.values(TradieScheduleStatus).includes(statusParam as TradieScheduleStatus)
      ? (statusParam as TradieScheduleStatus)
      : null;

    const tabOptions: TradieCoordinationTab[] = ["all", "week", "confirmed", "pending", "overdue", "completed"];
    const tab = tabOptions.includes(tabParam as TradieCoordinationTab) ? (tabParam as TradieCoordinationTab) : "all";

    const sortOptions: TradieCoordinationSortBy[] = ["scheduledDate", "tradieName", "tradeType", "projectName", "status"];
    const sortBy = sortOptions.includes(sortByParam as TradieCoordinationSortBy)
      ? (sortByParam as TradieCoordinationSortBy)
      : "scheduledDate";

    const payload = await getCachedTradieCoordinationDashboard({
      page,
      limit,
      search,
      projectId: projectId || null,
      tradeType: tradeType || null,
      status,
      tab,
      sortBy,
      sortOrder,
    });

    return NextResponse.json(payload);
  }

  const tradies = await getCachedTradies();

  return NextResponse.json(tradies);
}
