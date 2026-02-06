import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-wasm", "sql.js"],
};

export default nextConfig;
