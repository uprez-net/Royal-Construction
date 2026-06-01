import { ChatMessageAI, ChatSessionWithMessages } from "@/types/chat";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

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

export async function createChatMessages(messages: MessageData[]): Promise<void> {
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
    } catch (error) {
        console.error("Error creating chat message:", error);
        throw new Error("Failed to create chat message");
    }
}

export async function updateChatMessages(messages: MessageData[]): Promise<void> {
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
    } catch (error) {
        console.error("Error updating chat message:", error);
        throw new Error("Failed to update chat message");
    }
}