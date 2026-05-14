import { auth } from "@clerk/nextjs/server";
import { TradieScheduleStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCachedTradieCoordinationDashboard, getCachedTradies } from "@/lib/data/tradies";
import { TradieCoordinationSortBy, TradieCoordinationTab } from "@/types/project";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
