import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  // docusign-esign ships UMD/AMD wrappers Turbopack can't parse (TP1200);
  // resolve it with native require at runtime instead, and suppress the
  // parse issue its externals-tracing pass reports during `next build`
  // (the SDK still loads fine at runtime via require).
  serverExternalPackages: ["docusign-esign"],
  turbopack: {
    ignoreIssue: [{ path: "**/node_modules/**/docusign-esign/**" }],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "**.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default withWorkflow(nextConfig);
