import { createChatMessages, createOrGetChatSession, MessageData, updateChatMessages } from "@/lib/data/chat";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { fetchLeadFilesTool, fetchLeadInfoTool } from "@/lib/tools/fetch-lead-info";
import { FileProcessingTool } from "@/lib/tools/file-tools";
import { lineItemTool } from "@/lib/tools/line-item";
import { offerFileTool } from "@/lib/tools/offer-file";
import { ChatMessageAI } from "@/types/chat";
import { convertToUIMessage } from "@/utils/chat";
import { ChatSDKError } from "@/utils/chat-error";
import { gateway } from "@/lib/model";
import { auth } from "@clerk/nextjs/server";
import {
    convertToModelMessages,
    createUIMessageStream,
    JsonToSseTransformStream,
    smoothStream,
    // stepCountIs,
    streamText,
    UIMessage
} from "ai";
import { NextRequest } from "next/server";
import { v4 as generateUUID } from "uuid";
import { fetchOfferSheetRules } from "@/lib/tools/fetch-offer-sheet-rules";
import { OFFER_CHAT_SYSTEM_PROMPT } from "@/lib/agent/offer-prompts";

interface ChatRequestBody {
    leadId: number;
    message?: UIMessage;
    messages?: ChatMessageAI[];
}

export async function POST(request: NextRequest) {
    const { leadId, message, messages }: ChatRequestBody = await request.json();

    try {
        const { userId } = await auth();
        if (!leadId) {
            return new ChatSDKError("bad_request:chat").toResponse();
        }

        if (!userId) {
            console.log("Unauthorized request to chat API");
            return new ChatSDKError("unauthorized:chat").toResponse();
        }

        const dbUser = await getUserByClerkIdCached(userId);
        if (!dbUser) {
            console.error("User not found in database for Clerk ID:", userId);
            return new ChatSDKError("unauthorized:chat").toResponse();
        }

        const isContinuationRequest = !message && Array.isArray(messages);

        if (isContinuationRequest) {
            // Validate messages array for continuation requests
            if (messages.length === 0) {
                console.error("Invalid continuation: messages array is empty");
                return new ChatSDKError("bad_request:chat").toResponse();
            }
        } else {
            // Validate single message for normal requests
            if (!message || typeof message !== "object") {
                console.error("Invalid message: message is missing or not an object");
                return new ChatSDKError("bad_request:chat").toResponse();
            }

            // Validate message has required parts structure
            if (!message.parts || !Array.isArray(message.parts) || !message.role) {
                console.error("Invalid message structure:", {
                    hasParts: !!message.parts,
                    partsIsArray: Array.isArray(message.parts),
                    hasRole: !!message.role,
                });
                return new ChatSDKError("bad_request:chat").toResponse();
            }

            // Ensure message has an id (generate one if missing)
            if (!message.id) {
                message.id = generateUUID();
            }
        }

        const chat = await createOrGetChatSession(leadId);
        const dbMessages = chat.messages;
        const UIFormattedMessages: ChatMessageAI[] = [...convertToUIMessage(dbMessages), message as ChatMessageAI].filter(
            (msg): msg is ChatMessageAI =>
                msg != null && msg.parts != null && msg.role != null,
        );

        // Safety check - ensure we have valid messages to process
        if (UIFormattedMessages.length === 0) {
            console.error("No valid messages to process after filtering");
            return new ChatSDKError("bad_request:chat").toResponse();
        }

        const stream = createUIMessageStream({
            originalMessages: UIFormattedMessages,
            execute: async ({ writer: dataStream }) => {
                /* ---------------- AI Stream ---------------- */

                const result = streamText({
                    model: gateway("google/gemini-2.5-flash"),
                    temperature: 0.2,   // slightly higher — user-facing replies need to feel natural
                    topP: 0.90,
                    topK: 25,
                    presencePenalty: 0,
                    frequencyPenalty: 0.1,
                    system: OFFER_CHAT_SYSTEM_PROMPT,
                    messages: await convertToModelMessages(UIFormattedMessages),
                    stopSequences: [
                        "<END_OFFER_UPDATE>",
                        "<END_LINE_ITEM_UPDATE>",
                    ],
                    experimental_transform: smoothStream({ chunking: "word" }),
                    toolChoice: "auto",
                    tools: {
                        lineItemTool: lineItemTool(dataStream),
                        offerFileTool: offerFileTool(dataStream),
                        fetchLeadInfoTool: fetchLeadInfoTool,
                        fileProcessingTool: FileProcessingTool,
                        fetchOfferSheetRulesTool: fetchOfferSheetRules,
                        fetchLeadFilesTool: fetchLeadFilesTool,
                    }
                });

                result.consumeStream();

                dataStream.merge(
                    result.toUIMessageStream({
                        sendReasoning: false,
                    }),
                );
            },
            generateId: generateUUID,
            onFinish: async ({ messages: finishedMessages }) => {
                // Guard against undefined or empty messages
                if (!finishedMessages || finishedMessages.length === 0) {
                    console.warn("onFinish called with no messages");
                    return;
                }

                // Separate messages into new and updated
                const newMessages: MessageData[] = [];
                const messagesToUpdate: MessageData[] = [];

                for (const finishedMsg of finishedMessages) {
                    // Skip invalid messages
                    if (!finishedMsg?.id || !finishedMsg?.role || !finishedMsg?.parts) {
                        console.warn("Skipping invalid message in onFinish:", finishedMsg);
                        continue;
                    }

                    const existingMsg = UIFormattedMessages.find((m) => m?.id === finishedMsg.id);
                    if (existingMsg) {
                        messagesToUpdate.push({
                            id: finishedMsg.id,
                            role: finishedMsg.role,
                            content: finishedMsg.parts,
                            timestamp: new Date(),
                            sessionId: chat.id,
                        });
                    } else {
                        newMessages.push({
                            id: finishedMsg.id,
                            role: finishedMsg.role,
                            content: finishedMsg.parts,
                            timestamp: new Date(),
                            sessionId: chat.id,
                        });
                    }
                }

                // Bulk save all new messages at once
                if (newMessages.length > 0) {
                    await createChatMessages(newMessages, chat.leadId);
                }
                if (messagesToUpdate.length > 0) {
                    await updateChatMessages(messagesToUpdate, chat.leadId);
                }
            },
            onError: (error) => {
                console.error("Stream error:", {
                    error,
                    chatId: chat.id,
                    userId: dbUser.id,
                    vercelId: request.headers.get("x-vercel-id"),
                });

                // Return user-friendly message based on error type
                if (error instanceof ChatSDKError) {
                    return error.message;
                }
                if (error instanceof Error && error.message.includes("rate limit")) {
                    return "Too many requests. Please wait a moment.";
                }
                return "An error occurred while processing your request.";
            },
        });

        return new Response(stream.pipeThrough(new JsonToSseTransformStream()));

    } catch (error) {
        const vercelId = request.headers.get("x-vercel-id");

        console.error("Unhandled error in chat API:", error, { vercelId });
        return new ChatSDKError("offline:chat").toResponse();
    }
}