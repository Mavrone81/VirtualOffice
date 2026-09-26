import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Lean container image: bundle only the server + traced deps.
  output: "standalone",
  // @react-pdf/renderer uses dynamic requires (fonts/reconciler) — keep it out
  // of the webpack bundle and load it from node_modules at runtime.
  serverExternalPackages: ["@react-pdf/renderer"],
  // The app never uses next/image, so turn the optimizer off: it keeps sharp /
  // libvips / libheif (GHSA-2xp9-vwfh-vxw4 and follow-ups) out of the request
  // path entirely (SEC-7).
  images: { unoptimized: true },
  experimental: {
    // Onboarding submits a photo (app cap 5 MB) + a signature PNG data-URL via a
    // Server Action. Next's default Server Action body limit is 1 MB, which 413s
    // any real submission before the action runs. Lift it above the app-level cap
    // with headroom for the signature + form fields + multipart overhead.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default withNextIntl(nextConfig);
