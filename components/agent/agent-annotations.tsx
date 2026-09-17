"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Tags, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type AgentAnnotation = {
  type: string;
  id: string;
  label: string;
  href: string;
  group: string;
};

type AgentAnnotationsProps = {
  annotations: AgentAnnotation[];
  setAnnotations: Dispatch<SetStateAction<AgentAnnotation[]>>;
  annotationResults: AgentAnnotation[];
  annotationQuery: string;
  selectAnnotation: (annotation: AgentAnnotation) => void;
};

export function AgentAnnotations({ annotations, setAnnotations, annotationResults, annotationQuery, selectAnnotation }: AgentAnnotationsProps) {
  const isSearching = annotationQuery.length >= 2 && annotationResults.length > 0;
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const open = isSearching && dismissedQuery !== annotationQuery;

  if (annotations.length === 0 && !isSearching) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 left-5 z-10 flex min-w-0 items-start gap-2">
      {annotations.length > 0 ? (
        <div aria-label="Selected references" className="no-scrollbar pointer-events-auto flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto pb-0.5">
          {annotations.map((annotation) => (
            <Badge className="shrink-0" key={`${annotation.type}:${annotation.id}`} variant="secondary">
              {annotation.label}
              <button aria-label={`Remove ${annotation.label}`} className="ml-1" onClick={() => setAnnotations((items) => items.filter((item) => item.id !== annotation.id || item.type !== annotation.type))} type="button">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      {isSearching ? (
        <Popover modal={false} onOpenChange={(nextOpen) => setDismissedQuery(nextOpen ? null : annotationQuery)} open={open}>
          <PopoverTrigger asChild>
            <Button aria-label="Open annotation results" className="pointer-events-auto rounded-full bg-background/95 shadow-sm backdrop-blur" size="icon-sm" type="button" variant="outline">
              <Tags />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(42rem,calc(100vw-1rem))] p-2" onOpenAutoFocus={(event) => event.preventDefault()} side="top">
            <div className="no-scrollbar flex max-h-[min(28rem,calc(100vh-10rem))] min-h-24 flex-col gap-1 overflow-y-auto overscroll-contain">
              {annotationResults.map((annotation) => (
                <button className="flex w-full shrink-0 items-center justify-between rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted" key={`${annotation.type}:${annotation.id}`} onClick={() => selectAnnotation(annotation)} type="button">
                  <span className="truncate">{annotation.label}</span>
                  <span className="ml-3 shrink-0 text-xs text-muted-foreground">{annotation.group}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
