import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true,
  // Hide the bottom-left dev badge ("N Issues") — it overlaps workflow UI in dev.
  devIndicators: false,
  // docusign-esign ships UMD/AMD wrappers Turbopack can't parse (TP1200);
  // resolve it with native require at runtime instead, and suppress the
  // parse issue its externals-tracing pass reports during `next build`
  // (the SDK still loads fine at runtime via require).
  serverExternalPackages: ["docusign-esign"],
  typescript: {
    // `next build` runs the project-local `tsc` itself, which is the same work
    // `pnpm typecheck` does -- ~18s cold, ~8s warm. CI runs that check in its
    // own job, in parallel with this build, so the build there sets
    // SKIP_BUILD_TYPECHECK=1 to keep it off the build's critical path. The flag
    // is unset everywhere else, so a plain `pnpm build` (local, or `vercel
    // build` on the deploy path) still type-checks. Do NOT set it in a context
    // that has no separate typecheck.
    ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1",
  },
  turbopack: {
    root: process.cwd(),
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

export default withEve(withWorkflow(nextConfig));
