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
export async function findCustomerByContact(email?: string | null, phone?: string | null, tx?: Prisma.TransactionClient) {
    const prismClient = tx ?? prisma;
    if (email) {
        const customer = await prismClient.customer.findUnique({ where: { email } });
        if (customer) return customer;
    }

    if (phone) {
        const customer = await prismClient.customer.findUnique({ where: { phone } });
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
export async function createCustomerForProject(input: { name: string; email: string; phone: string; address?: string | null }, tx?: Prisma.TransactionClient) {

    const prismClient = tx ?? prisma;
    // When running INSIDE a caller's transaction, cache invalidation must not
    // fire here: the write has not committed yet, so another request could refill
    // the "customers" cache from pre-commit data and there would be no
    // post-commit invalidation to correct it (PR #124 review). The caller
    // revalidates after its transaction commits instead. Standalone calls (no tx)
    // are already committed by the time they return, so they invalidate here.
    const deferInvalidation = Boolean(tx);
    const invalidate = () => {
        if (!deferInvalidation) {
            revalidateTag("customers", CACHE_PROFILES.MEDIUM);
        }
    };
    const address = input.address?.trim() || null;
    const name = input.name?.trim();
    const email = input.email?.trim();
    const phone = input.phone?.trim();

    // Resolve email and phone INDEPENDENTLY (PR #124). The old helper returned the
    // email match and never looked at phone, so a conflict — email and phone
    // belonging to DIFFERENT customers — silently attached the Project to the
    // email record without anyone noticing. Here the conflict is explicit: email
    // is the authoritative identity and wins deterministically, but we never steal
    // the phone record's contact fields (below), and changed values are refreshed.
    const byEmail = email
        ? await prismClient.customer.findUnique({ where: { email } })
        : null;
    const byPhone = phone
        ? await prismClient.customer.findUnique({ where: { phone } })
        : null;
    const existing = byEmail ?? byPhone;

    if (existing) {
        const patch: Prisma.CustomerUpdateInput = {};
        if (name && name !== existing.name) patch.name = name;
        if (address && address !== existing.address) patch.address = address;
        // Refresh a changed email/phone only when no OTHER customer already holds
        // it, so we never trip the @unique constraint or hijack a different record.
        if (email && email !== existing.email && (byEmail === null || byEmail.id === existing.id)) {
            patch.email = email;
        }
        if (phone && phone !== existing.phone && (byPhone === null || byPhone.id === existing.id)) {
            patch.phone = phone;
        }
        if (Object.keys(patch).length > 0) {
            const updated = await prismClient.customer.update({
                where: { id: existing.id },
                data: patch,
            });
            invalidate();
            return updated;
        }
        return existing;
    }

    const customer = await prismClient.customer.create({
        data: {
            // Persist the NORMALISED values — the same trimmed locals the
            // findUnique lookups above use. Storing the raw input meant a record
            // created from " a@b.com " never matched the trimmed lookup again, so
            // the next call created a duplicate customer instead of reusing it.
            name,
            email,
            phone,
            address,
        },
    });

    invalidate();

    return customer;
}

