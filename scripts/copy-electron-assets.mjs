#!/usr/bin/env node
// Copies runtime assets into .next/standalone/ for Electron packaging.
// Cross-platform (works on macOS, Linux, and Windows).

import fs from "node:fs";
import path from "node:path";

const STANDALONE = path.resolve(".next", "standalone");

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// config.yaml
copyRecursive("config.yaml", path.join(STANDALONE, "config.yaml"));

// prompts/
copyRecursive("prompts", path.join(STANDALONE, "prompts"));

// public/
copyRecursive("public", path.join(STANDALONE, "public"));

// WASM binaries
copyRecursive(
  path.join("node_modules", "@resvg", "resvg-wasm", "index_bg.wasm"),
  path.join(STANDALONE, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm"),
);
copyRecursive(
  path.join("node_modules", "mupdf", "dist", "mupdf-wasm.wasm"),
  path.join(STANDALONE, "node_modules", "mupdf", "dist", "mupdf-wasm.wasm"),
);

console.log("Copied runtime assets to .next/standalone/");
