import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The app may live inside another repo for now; pin the project root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
