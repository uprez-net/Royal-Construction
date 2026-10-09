"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">
        Could not load the build sequence
      </h1>
      <p className="text-muted-foreground">Try loading it again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
