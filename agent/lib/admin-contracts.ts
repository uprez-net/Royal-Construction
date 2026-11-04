import {
  Role,
  TradieApprovalActionType,
  TradieApprovalStatus,
} from "@prisma/client";
import { z } from "zod";
import { jsonValueSchema } from "@/agent/lib/result-contracts";
import {
  buildScopeSchema,
  costScheduleDataSchema,
  hbcfClaimDataSchema,
  offerContentDataSchema,
  offerScopeWriteSchema,
} from "@/lib/validations/admin-offer-content";
import { milestoneTemplateEditSchema } from "@/lib/validations/milestone-template";

export const listApprovalsInputSchema = z.object({
  status: z.enum(TradieApprovalStatus).optional(),
  actionType: z.enum(TradieApprovalActionType).optional(),
  query: z.string().trim().max(120).default(""),
  limit: z.number().int().min(1).max(100).default(50),
});

export const getApprovalInputSchema = z.object({
  approvalId: z.string().uuid(),
});

export const resolveApprovalInputSchema = z
  .object({
    approvalId: z.string().uuid(),
    resolution: z.enum(["approved", "rejected"]),
    rejectionReason: z.string().trim().max(2_000).optional(),
    incidentResolution: z.string().trim().max(10_000).optional(),
  })
  .refine(
    (value) =>
      value.resolution !== "rejected" || Boolean(value.rejectionReason),
    {
      message: "A rejection reason is required.",
      path: ["rejectionReason"],
    },
  );

export const getAdminContentInputSchema = z.object({});
export const getBuildSequenceInputSchema = z.strictObject({});
export const updateBuildSequenceInputSchema = milestoneTemplateEditSchema;

export const updateAdminContentInputSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("buildScope"),
    expectedVersion: z.number().int().positive(),
    data: buildScopeSchema,
  }),
  z.object({
    section: z.literal("costSchedule"),
    expectedVersion: z.number().int().positive(),
    data: costScheduleDataSchema,
  }),
  z.object({
    section: z.literal("offerScope"),
    expectedVersion: z.number().int().positive(),
    data: offerScopeWriteSchema,
  }),
  z.object({
    section: z.literal("offerContent"),
    expectedVersion: z.number().int().positive(),
    data: offerContentDataSchema,
  }),
  z.object({
    section: z.literal("hbcfClaim"),
    expectedVersion: z.number().int().positive(),
    data: hbcfClaimDataSchema,
  }),
]);

export const listTeamInputSchema = z.object({
  query: z.string().trim().max(120).default(""),
  limit: z.number().int().min(1).max(100).default(50),
});

export const inviteTeamMemberInputSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(Role).default(Role.GUEST),
});

export const updateTeamRoleInputSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  newRole: z.enum(Role),
});

export const revokeTeamInvitationInputSchema = z.object({
  invitationId: z.string().trim().min(1).max(200),
});

export const disconnectXeroInputSchema = z.object({
  reason: z.string().trim().min(1).max(1_000),
});

export const adminJsonPayloadSchema = jsonValueSchema;
