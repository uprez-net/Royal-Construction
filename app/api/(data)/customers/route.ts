import { NextResponse } from "next/server";

import { getCachedCustomersForDropdown } from "@/lib/data/customers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  const query = url.searchParams.get("q") ?? "";

  const result = await getCachedCustomersForDropdown(page, limit, query);
  return NextResponse.json(result);
}