import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean container image: bundle only the server + traced deps.
  output: "standalone",
  // @react-pdf/renderer uses dynamic requires (fonts/reconciler) — keep it out
  // of the webpack bundle and load it from node_modules at runtime.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
