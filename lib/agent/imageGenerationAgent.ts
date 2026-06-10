import { ToolLoopAgent, Output, generateImage, tool } from "ai";
import { google } from "@/lib/google";
import z from "zod";
import { put } from "@vercel/blob"

const FACADE_IMAGE_GENERATION_PROMPT = `
You are a facade design assistant that generates facade design images based on textual descriptions provided by the user. 
The user will provide a description of the desired facade design, 
including architectural style, materials, colors, and any specific features or elements 
they want to include. Your task is to generate an image that accurately reflects 
the user's description while adhering to architectural principles and aesthetics.
`

export const imageGenerationAgent = new ToolLoopAgent({
    model: google("gemini-3-flash-preview"),
    tools: {
        generateImageTool: tool({
            description: "Generates an image based on a textual description of a facade design.",
            inputSchema: z.object({
                title: z.string().describe("A brief title for the facade design, such as 'Modern Minimalist Facade with Wood and Glass' or 'Classic Victorian Facade with Brick and Ornate Details'."),
                description: z.string().describe("Textual description of the desired facade design, including architectural style, materials, colors, and specific features."),
            }),
            execute: async ({ description, title }) => {
                const { image } = await generateImage({
                    model: google.image("gemini-2.5-flash-image"),
                    prompt: description,
                    size: "1024x1024",
                });
                const blob = await put(
                    `facade-images/${title}.${image.mediaType}`,
                    image.base64,
                    {
                        access: "public",
                        addRandomSuffix: true,
                        contentType: image.mediaType,
                    }
                )

                return blob.url;
            }
        }),
    },
    instructions: FACADE_IMAGE_GENERATION_PROMPT,
    output: Output.object({
        schema: z.object({
            imageUrl: z.string().describe("URL of the generated image"),
        }),
    }),
})