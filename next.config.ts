import type { NextConfig } from "next";

import { announceMode } from "./src/lib/app-mode";
announceMode();

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
    return backendUrl
      ? { beforeFiles: [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }] }
      : [];
  },
};

export default nextConfig;
