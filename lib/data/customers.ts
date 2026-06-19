"use server";

import { type Customer } from "@prisma/client";
import { revalidateTag, cacheTag, cacheLife } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";

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
/**
 * Fetches a paginated list of customers for dropdown selection, with optional search query.
 * @param page 
 * @param limit 
 * @param query 
 * @returns PaginatedLookupResult containing the list of customers and pagination metadata
 * @throws Error if database query fails
 * Also applies pagination, search filtering, and orders results by creation date descending.
 */
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

/**
 * Cached version of getCustomersDropdownPage. Applies caching with a medium lifespan and tags the cache for customers to allow targeted invalidation when customer data changes.
 * @param page 
 * @param limit 
 * @param query 
 * @returns PaginatedLookupResult containing the list of customers and pagination metadata
 * @throws Error if database query fails
 * Also applies pagination, search filtering, and orders results by creation date descending.
 */
export async function getCachedCustomersForDropdown(
    page = 1,
    limit = defaultPageSize,
    query?: string,
) {
    "use cache";

    cacheTag("customers");

    cacheLife(CACHE_PROFILES.MEDIUM);

    return getCustomersDropdownPage(page, limit, query);
}
/**
 * Exposed function to fetch customers for dropdown without caching, allowing for real-time data retrieval when needed.
 * @param page 
 * @param limit 
 * @param query 
 * @returns PaginatedLookupResult containing the list of customers and pagination metadata
 * @throws Error if database query fails
 * Also applies pagination, search filtering, and orders results by creation date descending.
 */
export async function getCustomersForDropdown(page = 1, limit = defaultPageSize, query?: string) {
    return getCustomersDropdownPage(page, limit, query);
}

/**
 * Fetch a single customer by their unique ID.
 * @param customerId 
 * @returns Customer
 */
export async function findCustomerById(customerId: string) {
    return prisma.customer.findUnique({ where: { id: customerId } });
}

/**
 * Fetch a single customer by their email or phone number. If both are provided, email is prioritized.
 * @param email 
 * @param phone 
 * @returns Customer
 */
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
/**
 * Creates a new customer for a project.
 * @param input - Object containing customer details such as name, email, and phone
 * @returns Customer - the newly created customer record
 * @throws Error if customer creation fails
 * Also triggers revalidation of the customers cache to ensure new customer appears in dropdowns.
 */
export async function createCustomerForProject(input: { name: string; email: string; phone: string }) {

    const existing = await findCustomerByContact(input.email, input.phone);
    if (existing) {
        return existing;
    }

    const customer = await prisma.customer.create({
        data: {
            name: input.name,
            email: input.email,
            phone: input.phone,
        },
    });

    revalidateTag("customers", CACHE_PROFILES.MEDIUM);

    return customer;
}

