import { Mistral } from "@mistralai/mistralai";


const apiKey = process.env.MISTRAL_AI_KEY;

if (!apiKey) {
  throw new Error("MISTRAL_AI_KEY is not set in the environment variables.");
}

export async function processPDFWithMistral(pdfLink: string) {
  const client = new Mistral({ apiKey });

  try {
    
    const response = await client.ocr.process({
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        documentUrl: pdfLink,
      },
      includeImageBase64: false,
      tableFormat: "markdown",
    });

    return response.pages;
  } catch (error) {
    console.error("Mistral OCR failed:", error);
    throw error;
  }
}