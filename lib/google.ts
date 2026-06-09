import { createGoogleGenerativeAI } from '@ai-sdk/google';

if(!process.env.GEMINI_API_KEY) {
    console.warn("Warning: GEMINI_API_KEY is not set. Google Generative AI features will not work.");
    throw new Error("GEMINI_API_KEY environment variable is required but not set.");
}

export const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
})