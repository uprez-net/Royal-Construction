"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ListTree, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default function ErrorPage({ retry }: { retry: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Project planning
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Build sequence
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The starting plan for every new project.
        </p>
      </div>
      <Card>
        <CardContent>
          <Empty className="min-h-80">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListTree />
              </EmptyMedia>
              <EmptyTitle>
                <h2>Could not load the build sequence</h2>
              </EmptyTitle>
              <EmptyDescription>
                The activity template could not be loaded. Try again to continue
                editing your stages, activities and tradie dependencies.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  disabled={pending}
                  onClick={() => startTransition(() => retry())}
                >
                  {pending ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  {pending ? "Loading sequence…" : "Try again"}
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/admin">
                    <ArrowLeft data-icon="inline-start" />
                    Back to admin
                  </Link>
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
