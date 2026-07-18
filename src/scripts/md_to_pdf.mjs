#!/usr/bin/env node
// Convert a Markdown file to a nicely styled PDF.
//
// As a command:
//   npx -y -p marked node src/scripts/md_to_pdf.mjs <input.md> [output.pdf]
//   (the `npx -y -p marked` prefix fetches the Markdown parser on demand)
//
// As a module:
//   import { mdFileToPdf } from "./md_to_pdf.mjs";
//   await mdFileToPdf("report.md");           // -> report.pdf
//
// Requirements:
//   - Node.js 18+
//   - Google Chrome or Microsoft Edge (used headless to print the PDF)
//   - The "marked" package (via the npx prefix above, or a local install)

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CSS = `
  @page { size: A4; margin: 22mm 20mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11.5pt; line-height: 1.6; color: #1f2328;
    max-width: 100%; margin: 0;
  }
  h1 { font-size: 22pt; margin: 0 0 4pt; line-height: 1.25; }
  h2 { font-size: 14pt; margin: 22pt 0 6pt; padding-bottom: 4pt;
       border-bottom: 1px solid #e3e6ea; }
  h1, h2, h3 { color: #0b3d2e; page-break-after: avoid; }
  p { margin: 0 0 9pt; }
  strong { color: #0b3d2e; }
  a { color: #1a6dc4; text-decoration: none; word-break: break-all; }
  ul, ol { margin: 0 0 9pt; padding-left: 22pt; }
  li { margin: 0 0 4pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0 14pt; font-size: 10.5pt; }
  th, td { border: 1px solid #d6dade; padding: 6pt 9pt; text-align: left; vertical-align: top; }
  th { background: #0b3d2e; color: #fff; }
  tr:nth-child(even) td { background: #f4f7f5; }
  code { background: #f0f2f4; padding: 1pt 4pt; border-radius: 3px;
         font-family: "Cascadia Code", Consolas, monospace; font-size: 10pt; }
  blockquote { margin: 0 0 9pt; padding: 2pt 14pt; border-left: 3px solid #0b3d2e;
               color: #41484f; }
`;

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

// Render a Markdown file to a styled PDF. Returns the output path.
export async function mdFileToPdf(input, output) {
  const { marked } = await import("marked");
  const inPath = resolve(input);
  const outPath = resolve(output || inPath.replace(/\.md$/i, ".pdf"));
  const tmpHtml = join(dirname(outPath), basename(outPath).replace(/\.pdf$/i, "") + ".tmp.html");

  const bodyHtml = marked.parse(readFileSync(inPath, "utf8"));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${basename(inPath)}</title>
<style>${CSS}</style>
</head><body>
${bodyHtml}
</body></html>`;
  writeFileSync(tmpHtml, html, "utf8");

  const browser = BROWSERS.find((p) => existsSync(p));
  if (!browser) {
    throw new Error("Could not find Chrome or Edge. HTML left at: " + tmpHtml);
  }
  execFileSync(browser, [
    "--headless", "--disable-gpu", "--no-pdf-header-footer",
    `--print-to-pdf=${outPath}`,
    "file:///" + tmpHtml.replace(/\\/g, "/"),
  ], { stdio: "ignore" });
  unlinkSync(tmpHtml);
  return outPath;
}

// CLI entry point
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node src/scripts/md_to_pdf.mjs <input.md> [output.pdf]");
    process.exit(1);
  }
  try {
    const out = await mdFileToPdf(input, process.argv[3]);
    console.log("PDF written to: " + out);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
