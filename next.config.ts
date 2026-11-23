import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

// Relative, not `@/`: next.config.ts is loaded before the alias exists. Pure
// module with no imports of its own.
import { notificationEnvironment } from "./lib/notification/environment";

// "Production" as the app already defines it (APP_ENV=staging wins over
// VERCEL_ENV=production — see lib/notification/environment.ts).
const reportingEnvironment = notificationEnvironment(process.env);

const nextConfig: NextConfig = {
  // The browser cannot read APP_ENV or VERCEL_ENV, so the server's answer is
  // inlined here for instrumentation-client.ts. Only a production build turns
  // browser error reporting on.
  env: { NEXT_PUBLIC_ERROR_REPORTING_ENV: reportingEnvironment },
  reactCompiler: true,
  cacheComponents: true,
  // Stated explicitly so Next stops warning that it is unset. `false` keeps
  // the prefetch behaviour this app was built and tested with. `true` makes a
  // default <Link> prefetch only the route's shared App Shell, so on param
  // routes (/projects/[id], /leads/[id]) the record's cached content would
  // stream after navigation instead of being prefetched. No link uses a full
  // prefetch (`prefetch={true}`), so adopting it is a test pass, not a
  // migration — see node_modules/next/dist/docs/01-app/02-guides/
  // adopting-partial-prefetching.md. It becomes the only behaviour in the next
  // major release.
  partialPrefetching: false,
  // Hide the bottom-left dev badge ("N Issues") — it overlaps workflow UI in dev.
  devIndicators: false,
  // docusign-esign ships UMD/AMD wrappers Turbopack can't parse (TP1200);
  // resolve it with native require at runtime instead, and suppress the
  // parse issue its externals-tracing pass reports during `next build`
  // (the SDK still loads fine at runtime via require).
  // ws (Mili's call audio, lib/comms/voice-agent) breaks when bundled — its
  // optional native helpers resolve to stubs ("bufferUtil.mask is not a
  // function") — so it is required from node_modules at runtime too.
  serverExternalPackages: ["docusign-esign", "ws"],
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
  // RFC 9728 puts the MCP endpoint's protected-resource metadata at
  // /.well-known/oauth-protected-resource/eve/v1/mcp, but only /eve/v1/* is
  // routed to the Eve agent (withEve's rewrite in dev, the generated Vercel
  // service route in production), so Eve publishes the document one level
  // inside that prefix instead -- see MCP_METADATA_PATH in
  // agent/lib/mcp-auth-policy.ts. A compliant MCP client follows the
  // resource_metadata URL in Eve's Bearer challenge and never needs this; it
  // is here for a client that goes straight to the well-known path.
  async redirects() {
    return [
      {
        destination: "/eve/v1/mcp/.well-known/oauth-protected-resource",
        permanent: true,
        source: "/.well-known/oauth-protected-resource/eve/v1/mcp",
      },
    ];
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
      // No Blob host. Stored files are private (#571): a screen loads one
      // through /api/files/signed-url with `unoptimized` (`storedImageProps`),
      // which never reaches the optimiser, and the optimiser could not read a
      // private object anyway — it has no session and a signed link expires.
      // Allowing `**.public.blob.vercel-storage.com` would only let anyone run
      // any Vercel tenant's public file through our optimiser.
    ],
  },
};

export default withSentryConfig(withEve(withWorkflow(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Quiet unless CI asked for the upload log.
  silent: !process.env.CI,
  telemetry: false,
  // Readable stack traces in the alert email: upload source maps for the
  // production build only. A local `pnpm build` or a staging deploy has the
  // token in its environment too and must not create releases.
  widenClientFileUpload: true,
  sourcemaps: {
    disable:
      reportingEnvironment !== "production" || !process.env.SENTRY_AUTH_TOKEN,
  },
});
