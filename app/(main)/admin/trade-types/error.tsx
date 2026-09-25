"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TradeTypesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100svh-96px)] w-full flex-col items-center justify-center bg-background p-4">
      <div className="mx-auto flex w-full max-w-110 flex-col items-center text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-destructive-light text-destructive ring-8 ring-destructive/10">
          <AlertTriangle className="size-10" />
        </div>

        <h2 className="mb-3 font-heading text-[22px] font-semibold tracking-tight text-foreground">
          Couldn&apos;t load the trade list
        </h2>

        <p className="mb-8 text-[14px] leading-relaxed text-muted-foreground">
          Nothing was changed. This is usually a temporary connection issue.
        </p>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={() => reset()}
            variant="royal"
            className="h-10 w-full px-6 text-[13px] font-semibold sm:w-auto"
          >
            <RefreshCw className="mr-2 size-4" />
            Try again
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-10 w-full border-border/80 px-6 text-[13px] font-semibold hover:bg-muted sm:w-auto"
          >
            <Link href="/admin">
              <ArrowLeft className="mr-2 size-4" />
              Back to Admin
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
