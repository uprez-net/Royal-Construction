"use server";
import { ChatMessageAI, ChatSessionWithMessages } from "@/types/chat";
import { prisma } from "@/lib/prisma";
import { Prisma, type File, type RunStatus } from "@prisma/client";
import { cacheTag, cacheLife, revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";

/**
 * Fetches an existing chat session for a lead or creates a new one if it doesn't exist.
 * @param leadId 
 * @returns ChatSessionWithMessages - the existing or newly created chat session with its messages
 * @throws Error if database operations fail
 * Also triggers revalidation of the chat session cache for the associated lead.
 */
export async function createOrGetChatSession(leadId: number): Promise<ChatSessionWithMessages> {
    try {
        const existingSession = await prisma.chatSession.findFirst({
            where: { leadId },
            include: { messages: true },
        });
        if (existingSession) {
            return existingSession;
        }

        const newSession = await prisma.chatSession.create({
            data: {
                leadId,
            },
            include: { messages: true },
        });

        revalidateTag(`chat-session-lead-${leadId}`, CACHE_PROFILES.SHORT);
        return newSession;
    } catch (error) {
        console.error("Error creating or getting chat session:", error);
        throw new Error("Failed to create or get chat session");
    }
}

export interface MessageData {
    id: string;
    sessionId: string;
    role: string;
    content: ChatMessageAI["parts"];
    timestamp: Date;
}

/**
 * Creates multiple chat messages in the database.
 * @param messages 
 * @param leadId 
 * @returns void
 * @throws Error if message creation fails
 * Also triggers revalidation of the chat session cache for the associated lead.
 */
export async function createChatMessages(messages: MessageData[], leadId: number): Promise<void> {
    try {
        await prisma.chatMessage.createMany({
            data: messages.map((msg) => ({
                id: msg.id,
                sessionId: msg.sessionId,
                role: msg.role,
                content: msg.content as Prisma.InputJsonValue,
                timestamp: msg.timestamp,
            })),
        })
        revalidateTag(`chat-session-lead-${leadId}`, CACHE_PROFILES.SHORT);
    } catch (error) {
        console.error("Error creating chat message:", error);
        throw new Error("Failed to create chat message");
    }
}

/**
 * Updates multiple chat messages in the database. Messages are matched by ID and updated with new content and timestamp.
 * @param messages 
 * @param leadId 
 * @returns Promise<void>
 * @throws Error if message update fails
 * Also triggers revalidation of the chat session cache for the associated lead.
 */
export async function updateChatMessages(
    messages: MessageData[],
    leadId: number
): Promise<void> {
    try {
        if (!messages.length) return;

        const values = Prisma.join(
            messages.map((msg) => Prisma.sql`
                (
                    ${msg.id},
                    ${msg.sessionId},
                    ${msg.role},
                    ${JSON.stringify(msg.content)}::jsonb,
                    ${msg.timestamp}
                )
            `)
        );

        await prisma.$executeRaw`
            INSERT INTO "ChatMessage"
            (
                "id",
                "sessionId",
                "role",
                "content",
                "timestamp"
            )
            VALUES ${values}
            ON CONFLICT ("id")
            DO UPDATE SET
                "content" = EXCLUDED."content",
                "timestamp" = EXCLUDED."timestamp";
        `;

        revalidateTag(
            `chat-session-lead-${leadId}`,
            CACHE_PROFILES.SHORT
        );
    } catch (error) {
        console.error("Error updating chat messages:", error);
        throw new Error("Failed to update chat messages");
    }
}

interface FetchChatResponse {
    chatSession: ChatSessionWithMessages | null;
    files: File[];
    leadInfo: {
        name: string;
        location: string;
        type: string;
        runId: string | null;
        runStatus: RunStatus | null;
        updatedAt: Date;
    };
}

/**
 * Fetches the chat session, associated files, and lead information for a given lead ID.
 * @param leadId
 * @return FetchChatResponse containing the chat session with messages, files, and lead information
 * @throws Error if fetching data fails
 * Also applies caching with a short lifespan and tags the cache with the lead ID for targeted invalidation.
 */
export async function getChatByLeadId(leadId: number): Promise<FetchChatResponse> {
    "use cache";
    cacheTag(`chat-session-lead-${leadId}`);
    cacheLife(CACHE_PROFILES.SHORT);
    try {
        const [chatSession, leadFiles, lead] = await Promise.all([
            prisma.chatSession.findFirst({
                where: { leadId },
                include: {
                    messages: {
                        orderBy: { timestamp: "asc" },
                    }
                },
            }),
            prisma.file.findMany({
                where: { leadId },
            }),
            prisma.lead.findUnique({
                where: { id: leadId },
                select: {
                    name: true,
                    location: true,
                    type: true,
                    runId: true,
                    runStatus: true,
                    updatedAt: true,
                }
            }),
        ]);

        if(!lead) {
            throw new Error("Lead not found");
        }

        return {
            chatSession,
            files: leadFiles,
            leadInfo: {
                ...lead,
                type: lead.type.length > 0 ? lead.type.join(", ") : "Not Specified"
            }
        };
    } catch (error) {
        console.error("Error fetching chat session by lead ID:", error);
        throw new Error("Failed to fetch chat session");
    }
}
