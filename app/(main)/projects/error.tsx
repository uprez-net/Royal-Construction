"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid gap-6">
      {/* Error Container */}
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 md:p-12">
        <div className="mx-auto max-w-md text-center">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="rounded-full bg-red-100 p-4">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </div>

          {/* Heading */}
          <h1 className="mb-2 text-2xl font-bold text-red-900">
            Something went wrong
          </h1>

          {/* Message */}
          <p className="mb-6 text-sm text-red-700">
            We encountered an error while loading your projects. This could be a temporary
            issue with your connection or our service. Please try again.
          </p>

          {/* Error Details (in development) */}
          {process.env.NODE_ENV === "development" && error.message && (
            <div className="mb-6 rounded-lg bg-white/50 p-4 text-left">
              <p className="text-xs font-mono text-red-600 break-words">
                {error.message}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              onClick={reset}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/")}
              className="border-red-200 text-red-700 hover:bg-red-100"
            >
              Return Home
            </Button>
          </div>

          {/* Help Text */}
          <p className="mt-6 text-xs text-red-600">
            If this problem persists, please contact support with reference:{" "}
            <span className="font-mono font-semibold">{error.digest || "unknown"}</span>
          </p>
        </div>
      </div>

      {/* FAQ / Troubleshooting */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-white p-6">
          <h3 className="mb-3 font-semibold text-foreground">Quick fixes to try:</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Refresh your browser</li>
            <li>• Clear your browser cache</li>
            <li>• Check your internet connection</li>
            <li>• Try a different browser</li>
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-white p-6">
          <h3 className="mb-3 font-semibold text-foreground">Still need help?</h3>
          <p className="text-sm text-muted-foreground mb-4">
            If you continue to experience issues, reach out to our support team.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // Open support email or contact page
              window.location.href = "mailto:support@royalconstructions.com.au";
            }}
          >
            Contact Support
          </Button>
        </div>
      </div>
    </div>
  );
}
