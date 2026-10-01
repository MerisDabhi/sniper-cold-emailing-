import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis"],
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
