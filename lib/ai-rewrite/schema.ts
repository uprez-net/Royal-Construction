import { z } from "zod";

// Single source of truth for the /api/ai request contract — imported by
// both the route handler (server) and the hook (client) so they can't
// drift apart. This file has no server-only imports, so it's safe to
// import from client components.

export const AI_ACTIONS = ["fix-grammar", "improve", "shorten"] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

export const aiRewriteRequestSchema = z.object({
  action: z.enum(AI_ACTIONS),
  text: z
    .string()
    .trim()
    .min(1, "Note text is required.")
    .max(8000, "Note text is too long (max 8000 characters)."),
});

export type AiRewriteRequest = z.infer<typeof aiRewriteRequestSchema>;

export type AiRewriteResponse = { text: string };

export type AiRewriteErrorResponse = {
  error: string;
  details?: Record<string, string[] | undefined>;
};
