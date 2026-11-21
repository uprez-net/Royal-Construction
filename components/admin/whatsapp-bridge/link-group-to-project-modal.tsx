"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";

import { ModalShell } from "@/components/common/modal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WhatsAppBridgeGroupDto } from "@/lib/projects/whatsapp-types";
import {
  linkBridgeGroup,
  searchProjects,
} from "@/lib/whatsapp-bridge/admin-service";
import { cn } from "@/lib/utils";

type ProjectOption = { id: string; name: string; location: string };

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
  const [options, setOptions] = useState<ProjectOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ProjectOption | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchProjects(query, controller.signal)
        .then((result) => {
          setOptions(result.items);
          setError(null);
        })
        .catch((loadError) => {
          if (controller.signal.aborted) return;
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not search projects.",
          );
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function link() {
    if (!chosen || linking) return;
    setLinking(true);
    try {
      await linkBridgeGroup(group.groupJid, chosen.id);
      toast.success(
        `“${group.subject}” linked to ${chosen.location || chosen.name}.`,
      );
      onLinked();
    } catch (linkError) {
      toast.error(
        linkError instanceof Error
          ? linkError.message
          : "The group could not be linked.",
      );
    } finally {
      setLinking(false);
    }
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

        {error ? (
          <p role="alert" className="text-sm text-destructive-ink">
            {error}
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
            disabled={!chosen || linking}
            onClick={() => void link()}
            className="bg-primary text-primary-foreground"
          >
            {linking ? (
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
