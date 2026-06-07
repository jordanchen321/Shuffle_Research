import type { NextConfig } from "next";
import path from "node:path";

/**
 * Next may pick a parent folder lockfile (e.g. C:\\Users\\…\\package-lock.json) as the
 * workspace root, which breaks App Router API routes. Pin Turbopack to this package.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  /** Less RAM during `next build` (slightly slower compile). */
  experimental: {
    webpackMemoryOptimizations: true,
  },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
