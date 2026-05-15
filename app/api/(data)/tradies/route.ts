import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);

        const search =
            url.searchParams.get("search") ??
            url.searchParams.get("q") ??
            "";

        const limit = Math.min(
            Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20,
            100
        );

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

        return NextResponse.json(tradies);
    } catch (error) {
        console.error("/api/tradies GET error", error);

        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}