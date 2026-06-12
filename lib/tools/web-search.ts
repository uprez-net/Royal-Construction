import { gateway } from "../model";
import { tool, generateText } from "ai"
import z from "zod";
import { getScrapeDoClient } from "../scrapedo/scraper";
import { SUMMARIES_WEB_PAGE_HTML } from "../agent/offer-prompts";

export const webSearch = gateway.tools.perplexitySearch({
    maxResults: 5,
    maxTokensPerPage: 1000,
    country: "AU",
    searchLanguageFilter: ["en"],
    searchDomainFilter: [
        'hipages.com.au',
        'serviceseeking.com.au',
        'bunnings.com.au',
        'rawlinsons.com.au',
        'oneflare.com.au',
        'fairtrading.nsw.gov.au',
        'consumer.vic.gov.au',
        'masterbuilders.com.au',
        'hia.com.au',
    ],
    searchRecencyFilter: "month",
})

const summarizeHtmlContent = async (html: string, context: string) => {
    const { text } = await generateText({
        model: gateway("xiaomi/mimo-v2.5"),
        system: SUMMARIES_WEB_PAGE_HTML,
        prompt: `
            ### Web Page HTML Content:
            ${html}

            ### Context:
            ${context}
        `,
    });

    return text.trim();
}

export const scrapeUserLinks = tool({
    description: "Scrape user links or relevant links from a document or webpage.",
    inputSchema: z.object({
        url: z.url().describe("The URL of the webpage to scrape links from."),
        context: z.string().describe("Additional context to help guide the scraping process, such as the specific information to extract."),
    }),
    execute: async ({ url, context }) => {
        try {
            const client = getScrapeDoClient();
            const html = await client.scrapeWithRateLimit(
                { url },
                `user-links-scrape-${new URL(url).hostname}`,
                { tokensPerInterval: 1000, interval: "minute" },
            );

            return {
                success: true,
                content: await summarizeHtmlContent(html, context),
            };
        } catch (error) {
            console.error("Error scraping user links:", error);
            return {
                success: false,
                content: `Failed to scrape the webpage at ${url}. Error: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
})