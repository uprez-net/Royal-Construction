import { ToolLoopAgent, Output, generateImage, tool } from "ai";
import { gateway } from "@/lib/model";
import z from "zod";
import { put } from "@vercel/blob"

const FACADE_IMAGE_GENERATION_PROMPT = `
You are a facade design assistant that generates facade design images based on textual descriptions provided by the user. 
The user will provide a description of the desired facade design, 
including architectural style, materials, colors, and any specific features or elements 
they want to include. Your task is to generate an image that accurately reflects 
the user's description while adhering to architectural principles and aesthetics.
`

function sanitizeFilename(value: string) {
    const safe = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 100);

    return safe || `facade-${Date.now()}`;
}

function mediaTypeToExtension(mediaType: string | undefined) {
    if (mediaType === "image/jpeg") return "jpg";
    if (mediaType === "image/webp") return "webp";
    return "png";
}

export const imageGenerationAgent = new ToolLoopAgent({
    model: gateway("google/gemini-2.5-flash"),
    tools: {
        generateImageTool: tool({
            description: "Generates an image based on a textual description of a facade design.",
            inputSchema: z.object({
                title: z.string().describe("A brief title for the facade design, such as 'Modern Minimalist Facade with Wood and Glass' or 'Classic Victorian Facade with Brick and Ornate Details'."),
                description: z.string().describe("Textual description of the desired facade design, including architectural style, materials, colors, and specific features."),
            }),
            execute: async ({ description, title }) => {
                try {
                    const { image } = await generateImage({
                        model: gateway.image("google/imagen-4.0-fast-generate-001"),
                        prompt: description,
                        aspectRatio: "16:9",
                    });
                    if (!image?.base64) {
                        throw new Error("Image generation returned no image data");
                    }
                    const contentType = image.mediaType || "image/png";
                    const blob = await put(
                        `facade-images/${sanitizeFilename(title)}.${mediaTypeToExtension(contentType)}`,
                        Buffer.from(image.base64, "base64"),
                        {
                            access: "public",
                            addRandomSuffix: true,
                            contentType,
                        }
                    )

                    return blob.url;
                } catch (error) {
                    console.error("Failed to generate facade image", { title, error });
                    throw new Error(`Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
                }
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
