"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProjectDetailError({
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
    <div className="flex min-h-125 w-full flex-col items-center justify-center p-4">
      <div className="mx-auto flex w-full max-w-110 flex-col items-center text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-red-50 text-red-600 ring-8 ring-red-50/50">
          <AlertTriangle className="size-10" />
        </div>
        
        <h2 className="mb-3 text-[22px] font-extrabold tracking-tight text-slate-900">
          Failed to load project details
        </h2>
        
        <p className="mb-8 text-[14px] leading-relaxed text-muted-foreground">
          We encountered an unexpected error while retrieving this project&apos;s information. 
          The project may have been removed, or there might be a temporary connection issue.
        </p>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={() => reset()}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white sm:w-auto px-6 h-10 rounded-lg text-[13px] font-semibold"
          >
            <RefreshCw className="mr-2 size-4" />
            Try again
          </Button>
          <Button
            asChild
            variant="outline"
            className="w-full sm:w-auto px-6 h-10 rounded-lg border-border/80 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Link href="/projects">
              <ArrowLeft className="mr-2 size-4" />
              Back to Projects
            </Link>
          </Button>
        </div>
        
        {process.env.NODE_ENV === "development" && (
          <div className="mt-10 w-full overflow-hidden rounded-xl border border-red-100 bg-red-50/50 text-left">
            <div className="border-b border-red-100 bg-red-50 px-4 py-2">
              <p className="text-[12px] font-bold uppercase tracking-wider text-red-800">
                Error Details (Development Only)
              </p>
            </div>
            <div className="p-4">
              <p className="font-mono text-[11px] text-red-600 [word-break:break-word]">
                {error.message || "An unknown error occurred"}
              </p>
              {error.digest && (
                <p className="mt-2 font-mono text-[11px] text-red-500">
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
