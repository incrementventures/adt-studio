#!/usr/bin/env npx tsx
/**
 * Visual PDF Extraction Debugger
 *
 * Extracts a PDF page and generates an interactive HTML report
 * showing all extracted images, their bounding boxes, and metadata.
 *
 * Usage: npx tsx scripts/visualize-extraction.mts <pdf-file> [page-number]
 */

import { readFile, writeFile } from "fs/promises";
import { exec } from "child_process";
import { extractPdf } from "../lib/pdf/extract.ts";

const pdfPath = process.argv[2];
const pageNum = parseInt(process.argv[3] || "1", 10);

if (!pdfPath) {
  console.error("Usage: npx tsx scripts/visualize-extraction.mts <pdf-file> [page-number]");
  process.exit(1);
}

console.log(`Extracting page ${pageNum} from ${pdfPath}...`);

const pdfBuffer = await readFile(pdfPath);
const result = await extractPdf({
  pdfBuffer,
  startPage: pageNum,
  endPage: pageNum,
});

const page = result.pages[0];
if (!page) {
  console.error(`Page ${pageNum} not found`);
  process.exit(1);
}

// Convert images to base64
const pageImageB64 = page.pageImage.pngBuffer.toString("base64");
const imagesB64 = page.images.map((img) => ({
  ...img,
  pngBuffer: undefined,
  b64: img.pngBuffer.toString("base64"),
}));

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PDF Extraction - ${pdfPath} Page ${pageNum}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      padding: 20px;
    }
    h1 { margin-bottom: 10px; font-size: 1.4em; }
    .meta { color: #888; margin-bottom: 20px; font-size: 0.9em; }
    .container { display: flex; gap: 20px; }
    .page-preview {
      flex: 0 0 400px;
      position: sticky;
      top: 20px;
      align-self: flex-start;
    }
    .page-preview img {
      max-width: 100%;
      border: 1px solid #333;
      border-radius: 4px;
    }
    .images-grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 15px;
    }
    .image-card {
      background: #252525;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 12px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .image-card:hover { border-color: #666; }
    .image-card.selected { border-color: #4a9eff; }
    .image-card img {
      max-width: 100%;
      max-height: 150px;
      display: block;
      margin: 0 auto 10px;
      background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 10px 10px;
    }
    .image-card .info {
      font-size: 0.8em;
      color: #aaa;
    }
    .image-card .id { font-weight: bold; color: #fff; margin-bottom: 4px; }
    .image-card .dims { color: #888; }
    .image-card .size { color: #666; }
    .detail-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 500px;
      height: 100vh;
      background: #1e1e1e;
      border-left: 1px solid #333;
      padding: 20px;
      transform: translateX(100%);
      transition: transform 0.2s;
      overflow-y: auto;
      z-index: 100;
    }
    .detail-panel.open { transform: translateX(0); }
    .detail-panel .close {
      position: absolute;
      top: 15px;
      right: 15px;
      background: none;
      border: none;
      color: #888;
      font-size: 1.5em;
      cursor: pointer;
    }
    .detail-panel img {
      max-width: 100%;
      background: repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 10px 10px;
      margin-bottom: 15px;
    }
    .detail-panel h2 { margin-bottom: 15px; }
    .detail-panel pre {
      background: #111;
      padding: 10px;
      border-radius: 4px;
      font-size: 0.85em;
      overflow-x: auto;
    }
    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .stat {
      background: #252525;
      padding: 10px 15px;
      border-radius: 4px;
    }
    .stat .label { font-size: 0.8em; color: #888; }
    .stat .value { font-size: 1.2em; font-weight: bold; }
  </style>
</head>
<body>
  <h1>PDF Extraction Visualizer</h1>
  <div class="meta">${pdfPath} — Page ${pageNum} of ${result.totalPagesInPdf}</div>

  <div class="stats">
    <div class="stat">
      <div class="label">Total Images</div>
      <div class="value">${page.images.length}</div>
    </div>
    <div class="stat">
      <div class="label">Page Size</div>
      <div class="value">${page.pageImage.width}×${page.pageImage.height}</div>
    </div>
    <div class="stat">
      <div class="label">Text Length</div>
      <div class="value">${page.text.length} chars</div>
    </div>
  </div>

  <div class="container">
    <div class="page-preview">
      <img src="data:image/png;base64,${pageImageB64}" alt="Full page">
    </div>
    <div class="images-grid">
      ${imagesB64
        .map(
          (img, i) => `
        <div class="image-card" data-index="${i}">
          <img src="data:image/png;base64,${img.b64}" alt="${img.imageId}">
          <div class="info">
            <div class="id">${img.imageId}</div>
            <div class="dims">${img.width}×${img.height}</div>
            <div class="size">${(img.b64.length * 0.75 / 1024).toFixed(1)} KB</div>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  </div>

  <div class="detail-panel" id="detail">
    <button class="close" onclick="closeDetail()">×</button>
    <div id="detail-content"></div>
  </div>

  <script>
    const images = ${JSON.stringify(imagesB64.map((img) => ({ ...img, b64: undefined })))};
    const imagesB64 = ${JSON.stringify(imagesB64.map((img) => img.b64))};

    document.querySelectorAll('.image-card').forEach((card, i) => {
      card.addEventListener('click', () => showDetail(i));
    });

    function showDetail(i) {
      const img = images[i];
      const b64 = imagesB64[i];
      document.getElementById('detail-content').innerHTML = \`
        <h2>\${img.imageId}</h2>
        <img src="data:image/png;base64,\${b64}" alt="\${img.imageId}">
        <pre>\${JSON.stringify(img, null, 2)}</pre>
      \`;
      document.getElementById('detail').classList.add('open');
      document.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.image-card')[i].classList.add('selected');
    }

    function closeDetail() {
      document.getElementById('detail').classList.remove('open');
      document.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDetail();
    });
  </script>
</body>
</html>`;

const outputPath = `/tmp/pdf-extraction-${Date.now()}.html`;
await writeFile(outputPath, html);
console.log(`Generated: ${outputPath}`);

// Open in browser
exec(`open "${outputPath}"`);
