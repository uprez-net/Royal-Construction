import z from "zod";
import { Role } from "@prisma/client";

export const userSearchQuerySchema = z.object({

    q: z
        .string()
        .trim()
        .default(""),
    limit: z.coerce
        .number()
        .int()
        .positive()
        .max(100)
        .default(20),
    userPage: z.coerce
        .number()
        .int()
        .positive()
        .default(1),
    invitePage: z.coerce
        .number()
        .int()
        .positive()
        .default(1),
});

export const createUserInvitationSchema = z.object({
    email: z.email(),
    role: z.enum(Role),
});

export const updateUserRoleSchema = z.object({
    userId: z.string(),
    newRole: z.enum(Role),
});

export const revokeUserInvitationSchema = z.object({
    invitationId: z.string(),
});