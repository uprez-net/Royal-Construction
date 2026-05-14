import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getCachedSiteManagersForDropdown } from "@/lib/data/siteManagers";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const query = url.searchParams.get("q") ?? "";

  const result = await getCachedSiteManagersForDropdown(page, limit, query);
  return NextResponse.json(result);
}