import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
    return backendUrl
      ? { beforeFiles: [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }] }
      : [];
  },
};

export default nextConfig;
