"use server";

import { Role, type User } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export type SiteManagerDropdownItem = Pick<User, "id" | "name" | "email" | "phone" | "createdAt">;

export type PaginatedLookupResult<T> = {
    items: T[];
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
};

const defaultPageSize = 10;

function normalizeQuery(query?: string) {
    return query?.trim() ?? "";
}

async function getSiteManagersDropdownPage(
    page: number,
    limit: number,
    query?: string,
): Promise<PaginatedLookupResult<SiteManagerDropdownItem>> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : defaultPageSize;
    const search = normalizeQuery(query);

    const where = {
        role: Role.SITE_MANAGER,
        ...(search
            ? {
                    OR: [
                        { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
                        { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
                        { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
                    ],
                }
            : {}),
    };

    const [items, totalCount] = await prisma.$transaction([
        prisma.user.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (safePage - 1) * safeLimit,
            take: safeLimit,
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                createdAt: true,
            },
        }),
        prisma.user.count({ where }),
    ]);

    return {
        items,
        page: safePage,
        limit: safeLimit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
    };
}

export const getCachedSiteManagersForDropdown = unstable_cache(
    async (page = 1, limit = defaultPageSize, query?: string) => getSiteManagersDropdownPage(page, limit, query),
    ["site-managers-dropdown"],
    { tags: ["site-managers"], revalidate: 300 },
);

export async function getSiteManagersForDropdown(page = 1, limit = defaultPageSize, query?: string) {
    return getSiteManagersDropdownPage(page, limit, query);
}

export async function getSiteManagerById(siteManagerId: string) {
    return prisma.user.findFirst({
        where: {
            id: siteManagerId,
            role: Role.SITE_MANAGER,
        },
    });
}