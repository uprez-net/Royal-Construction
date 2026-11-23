// Headless Chromium from HTML. Not a "use server" module: exported from one,
// it would be an endpoint that renders arbitrary HTML for anyone who calls it
// (tests/offer/use-server-surface.test.ts). Not "server-only" either, because
// Eve's offer sends render the same documents and "server-only" throws outside
// a React bundler. Chromium cannot load in a browser bundle regardless.
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

import { signBlobUrlsInHtml } from "@/lib/blob-port";

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

  // Offer images, checklist photos and the like are private files (#571), and
  // the headless browser has no session: each is handed a short-lived read
  // link. Signed before Chromium starts, so a file that cannot be signed fails
  // the render outright instead of producing a PDF with a hole in it.
  const signedHtml = await signBlobUrlsInHtml(html);

  // 3️⃣ Launch Chromium (Vercel-safe)
  let browser;
  if (process.env.NODE_ENV === "development") {
    // Full puppeteer (with its own Chromium) is a dev dependency, loaded only
    // here: production uses puppeteer-core with @sparticuz/chromium below.
    const { default: puppeteerDev } = await import("puppeteer");
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
  await page.setContent(signedHtml, { waitUntil: "load" });

  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
  });
  // convert Buffer/Uint8Array to base64 string
  const pdfBase64 = Buffer.from(pdf).toString("base64");
  await browser.close();
  return pdfBase64;
}
