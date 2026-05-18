import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  tradieSearchQuerySchema,
  parseSearchParamsWithResponse,
  successResponse,
  errorResponse,
} from "@/utils/validators";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = parseSearchParamsWithResponse(url, tradieSearchQuerySchema);
    if (!params.success) return params.response;

    const search = params.data.search || params.data.q || "";
    const limit = params.data.limit;

    const where: Prisma.TradieWhereInput | undefined = search
      ? {
          OR: [
            {
              name: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              company: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              tradeType: {
                contains: search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : undefined;

    const tradies = await prisma.tradie.findMany({
      where,
      take: limit,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        company: true,
        tradeType: true,
        phone: true,
        email: true,
      },
    });

    return successResponse(tradies);
  } catch (error) {
    console.error("/api/tradies GET error", error);
    return errorResponse("Failed to fetch tradies", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}