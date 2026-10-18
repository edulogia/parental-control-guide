import fs from "node:fs";
import path from "node:path";
import { chromium, Browser } from "playwright";

export interface PdfGenerationJob {
  html: string;
  outputPdfPath: string;
  outputHtmlPath?: string;
}

/**
 * Genera uno o più file PDF a partire dal contenuto HTML assemblato,
 * utilizzando Playwright (Chromium headless) senza intestazione né piè di pagina.
 */
export async function generatePdfs(jobs: PdfGenerationJob[]): Promise<void> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    for (const job of jobs) {
      fs.mkdirSync(path.dirname(job.outputPdfPath), { recursive: true });

      if (job.outputHtmlPath) {
        fs.mkdirSync(path.dirname(job.outputHtmlPath), { recursive: true });
        fs.writeFileSync(job.outputHtmlPath, job.html, "utf-8");
      }

      const page = await context.newPage();
      await page.setContent(job.html, { waitUntil: "networkidle" });

      await page.pdf({
        path: job.outputPdfPath,
        format: "A4",
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
      });

      await page.close();
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
