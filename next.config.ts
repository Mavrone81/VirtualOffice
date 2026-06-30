import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean container image: bundle only the server + traced deps.
  output: "standalone",
};

export default nextConfig;
