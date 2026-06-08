"use server";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import puppeteerDev from "puppeteer";

type GeneratePDFOptions = {
    html?: string;
};
const remoteExecutablePath =
    "https://github.com/Sparticuz/chromium/releases/download/v121.0.0/chromium-v121.0.0-pack.tar";

export async function generatePDF({
    html,
}: GeneratePDFOptions): Promise<string> {
    // 1️⃣ Validate HTML and sanitize input
    if (!html) {
        throw new Error("HTML content is required to generate PDF.");
    }

    // 3️⃣ Launch Chromium (Vercel-safe)
    let browser;
    if (process.env.NODE_ENV === "development") {
        browser = await puppeteerDev.launch({
            headless: true,
        });
    } else {
        browser = await puppeteer.launch({
            args: chromium.args,
            executablePath: await chromium.executablePath(remoteExecutablePath),
            headless: true,
        });
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
            top: "20mm",
            bottom: "20mm",
            left: "15mm",
            right: "15mm",
        },
    });
    // convert Buffer/Uint8Array to base64 string
    const pdfBase64 = Buffer.from(pdf).toString("base64");
    await browser.close();
    return pdfBase64;
}
