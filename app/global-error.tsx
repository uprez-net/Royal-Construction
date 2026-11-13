"use client";

import { useEffect } from "react";

import { isServerOriginError } from "@/lib/observability/filter";
import { reportError } from "@/lib/observability/report-error";

// Replaces the root layout when the layout itself throws, so it carries its
// own <html>, <body> and styles: the app's CSS and theme are not loaded here.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // An error with a digest began on the server and was reported there with
    // its real message; this copy is a redacted stub.
    if (!isServerOriginError(error)) {
      reportError(error, { source: "browser:global-error" });
    }
  }, [error]);

  const digest =
    typeof error === "object"
    && error !== null
    && typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1rem",
        }}
      >
        <main style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ lineHeight: 1.5 }}>
            The page could not be loaded. Nothing has been changed, so trying
            again is safe. If it keeps happening, tell the team
            {digest ? ` and quote reference ${digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
