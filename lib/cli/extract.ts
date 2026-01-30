import { extract } from "../pipeline/extract/extract.js";
import { runWithProgress } from "./progress.js";

const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error("Usage: extract <pdf_path>");
  process.exit(1);
}

await runWithProgress(
  extract(pdfPath),
  (p) => ({ current: p.page, total: p.totalPages }),
  { label: "extract" }
);
