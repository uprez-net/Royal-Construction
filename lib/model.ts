import { createGateway } from "ai";

if(!process.env.AI_GATEWAY_API_KEY ) {
    console.warn("Warning: AI_GATEWAY_API_KEY is not set. AI features will not work.");
    throw new Error("AI_GATEWAY_API_KEY environment variable is required but not set.");
}

export const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
})

