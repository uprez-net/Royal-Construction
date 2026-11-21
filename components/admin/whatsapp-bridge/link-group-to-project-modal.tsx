"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WhatsAppBridgeGroupDto } from "@/lib/projects/whatsapp-types";
import { cn } from "@/lib/utils";

import {
  errorText,
  useLinkBridgeGroup,
  useProjectSearch,
} from "./bridge-queries";

type ProjectOption = { id: string; name: string; location: string };

/** Debounce a typed value, so a search is not sent per keystroke. */
function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Pick the project a group belongs to. A project has one group, so linking
 * here is refused (with the reason) when the project already has one.
 */
export function LinkGroupToProjectModal({
  group,
  onClose,
  onLinked,
}: {
  group: WhatsAppBridgeGroupDto;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState("");
  const search = useProjectSearch(useDebounced(query, 200));
  const link = useLinkBridgeGroup();
  const [chosen, setChosen] = useState<ProjectOption | null>(null);
  const options = search.data;

  function submit() {
    if (!chosen || link.isPending) return;
    link.mutate(
      { groupJid: group.groupJid, projectId: chosen.id },
      {
        onError: (error) =>
          toast.error(errorText(error, "The group could not be linked.")),
        onSuccess: () => {
          toast.success(
            `“${group.subject}” linked to ${chosen.location || chosen.name}.`,
          );
          onLinked();
        },
      },
    );
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Link group to a project"
      subtitle={`New messages in “${group.subject || "this group"}” will come into the project you choose.`}
      maxWidthClass="max-w-[520px]"
    >
      <div className="space-y-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by project name or address"
            aria-label="Search projects"
            className="pl-9"
          />
        </div>

        {search.isError ? (
          <p role="alert" className="text-sm text-destructive-ink">
            {errorText(search.error, "Could not search projects.")}
          </p>
        ) : !options ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading projects…
          </p>
        ) : options.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No project matches.
          </p>
        ) : (
          <ul
            className="max-h-[45vh] space-y-1.5 overflow-y-auto"
            role="radiogroup"
            aria-label="Projects"
          >
            {options.map((option) => {
              const selected = chosen?.id === option.id;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setChosen(option)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-primary bg-royal-gold-light"
                        : "border-border/70 hover:bg-muted/50",
                    )}
                  >
                    <span className="block truncate font-medium text-foreground">
                      {option.location || option.name}
                    </span>
                    {option.location ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.name}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!chosen || link.isPending}
            onClick={submit}
            className="bg-primary text-primary-foreground"
          >
            {link.isPending ? (
              <Loader2
                className="mr-1.5 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            Link group
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
