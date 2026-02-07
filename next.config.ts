import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@resvg/resvg-wasm", "sql.js", "mupdf"],
};

export default nextConfig;
