"use server";
import { ChatMessageAI, ChatSessionWithMessages } from "@/types/chat";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { cacheTag, cacheLife, revalidateTag } from "next/cache";
import { CACHE_PROFILES } from "@/types/cache";

export async function createOrGetChatSession(leadId: number, userId: string): Promise<ChatSessionWithMessages> {
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
                userId,
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

export async function updateChatMessages(messages: MessageData[], leadId: number): Promise<void> {
    try {
        await prisma.$transaction(
            messages.map((msg) =>
                prisma.chatMessage.update({
                    where: { id: msg.id },
                    data: {
                        content: msg.content as Prisma.InputJsonValue,
                        timestamp: msg.timestamp,
                    },
                })
            )
        );
        revalidateTag(`chat-session-lead-${leadId}`, CACHE_PROFILES.SHORT);
    } catch (error) {
        console.error("Error updating chat message:", error);
        throw new Error("Failed to update chat message");
    }
}

export async function getChatByLeadId(leadId: number): Promise<ChatSessionWithMessages | null> {
    "use cache";
    cacheTag(`chat-session-lead-${leadId}`);
    cacheLife(CACHE_PROFILES.SHORT);
    try {
        const chatSession = await prisma.chatSession.findFirst({
            where: { leadId },
            include: { messages: true },
        });
        return chatSession;
    } catch (error) {
        console.error("Error fetching chat session by lead ID:", error);
        throw new Error("Failed to fetch chat session");
    }
}