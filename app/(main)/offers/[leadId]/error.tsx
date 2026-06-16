"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OfferDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100svh-96px)] w-full flex-col items-center justify-center bg-background p-4">
      <div className="mx-auto flex w-full max-w-110 flex-col items-center text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-destructive-light text-destructive ring-8 ring-destructive/10">
          <AlertTriangle className="size-10" />
        </div>
        
        <h2 className="mb-3 font-heading text-[22px] font-semibold tracking-tight text-foreground">
          Failed to load offer details
        </h2>
        
        <p className="mb-8 text-[14px] leading-relaxed text-muted-foreground">
          We encountered an unexpected error while retrieving this offer&apos;s information. 
          The offer may have been removed, or there might be a temporary connection issue.
        </p>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={() => reset()}
            className="h-10 w-full bg-royal-gold px-6 text-[13px] font-semibold text-primary-foreground hover:bg-royal-gold-dark sm:w-auto"
          >
            <RefreshCw className="mr-2 size-4" />
            Try again
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-10 w-full border-border/80 px-6 text-[13px] font-semibold hover:bg-muted sm:w-auto"
          >
            <Link href="/offers">
              <ArrowLeft className="mr-2 size-4" />
              Back to Offers
            </Link>
          </Button>
        </div>
        
        {process.env.NODE_ENV === "development" && (
          <div className="mt-10 w-full overflow-hidden rounded-lg border border-destructive/20 bg-destructive-light text-left">
            <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2">
              <p className="text-[12px] font-bold uppercase tracking-wider text-destructive">
                Error Details (Development Only)
              </p>
            </div>
            <div className="p-4">
              <p className="font-mono text-[11px] text-destructive [word-break:break-word]">
                {error.message || "An unknown error occurred"}
              </p>
              {error.digest && (
                <p className="mt-2 font-mono text-[11px] text-destructive/80">
                  Digest: {error.digest}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
