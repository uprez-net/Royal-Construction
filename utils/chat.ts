import { ChatMessageAI, ChatTools } from "@/types/chat";
import type { ChatMessage } from "@prisma/client";
import { formatISO } from "date-fns";
import { UIMessagePart, UIDataTypes } from "ai";

export const convertToUIMessage = (message: ChatMessage[]): ChatMessageAI[] => {
    return message.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant" | "system",
        parts: msg.content as UIMessagePart<UIDataTypes, ChatTools>[],
        metadata: {
            createdAt: formatISO(msg.timestamp),
        },
    }));
}