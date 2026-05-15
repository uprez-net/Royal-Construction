"use server";

import { Role, type Customer } from "@prisma/client";
import { revalidateTag, unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export type CustomerDropdownItem = Pick<Customer, "id" | "name" | "email" | "phone" | "createdAt">;

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

async function getCustomersDropdownPage(
    page: number,
    limit: number,
    query?: string,
): Promise<PaginatedLookupResult<CustomerDropdownItem>> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : defaultPageSize;
    const search = normalizeQuery(query);

    const where = search
        ? {
                OR: [
                    { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
                    { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
                    { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
                ],
            }
        : undefined;

    const [items, totalCount] = await prisma.$transaction([
        prisma.customer.findMany({
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
        prisma.customer.count({ where }),
    ]);

    return {
        items,
        page: safePage,
        limit: safeLimit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
    };
}

export const getCachedCustomersForDropdown = unstable_cache(
    async (page = 1, limit = defaultPageSize, query?: string) => getCustomersDropdownPage(page, limit, query),
    ["customers-dropdown"],
    { tags: ["customers"], revalidate: 300 },
);

export async function getCustomersForDropdown(page = 1, limit = defaultPageSize, query?: string) {
    return getCustomersDropdownPage(page, limit, query);
}

export async function findCustomerById(customerId: string) {
    return prisma.customer.findUnique({ where: { id: customerId } });
}

export async function findCustomerByContact(email?: string | null, phone?: string | null) {
    if (email) {
        const customer = await prisma.customer.findUnique({ where: { email } });
        if (customer) return customer;
    }

    if (phone) {
        const customer = await prisma.customer.findUnique({ where: { phone } });
        if (customer) return customer;
    }

    return null;
}

export async function createCustomerForProject(input: { name: string; email: string; phone: string }) {
    const user = await prisma.user.create({
        data: {
            name: input.name,
            email: input.email,
            phone: input.phone,
            clerkId: crypto.randomUUID(),
            role: Role.CUSTOMER,
        },
    });

    const customer = await prisma.customer.create({
        data: {
            userId: user.id,
            name: input.name,
            email: input.email,
            phone: input.phone,
        },
    });

    await prisma.user.update({
        where: { id: user.id },
        data: { customerId: customer.id },
    });

    revalidateTag("customers", "max");

    return customer;
}

