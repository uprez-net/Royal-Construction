import { createGateway } from "ai";

if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY environment variable is required but not set.");
}

const apiKey = process.env.AI_GATEWAY_API_KEY;

export const gateway = createGateway({
    apiKey,
})
