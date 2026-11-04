"use client";

import { useEffect, useId, useState } from "react";
import { Check, ChevronDown, HardHat, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setActiveProject } from "@/lib/store/slices/projectsSlice";
import { fetchSiteManagers } from "@/lib/store/slices/siteManagersSlice";
import type { ProjectDetail } from "@/types/project";
import { fetchJson } from "@/utils/fetch";
import { RoleLabelRecord } from "@/utils/formatters";

const PAGE_SIZE = 10;

/**
 * The project's site manager, and for an ADMIN the control that reassigns it.
 *
 * Reads like text — the name, underlined — and opens a searchable list. The
 * list is the same `/api/site-managers` lookup the create-project wizard uses,
 * so the people offered here are exactly the people a project can be created
 * with. Who may reassign, and who may be assigned, is decided by
 * `assignProjectSiteManager`; `canAssign` only decides whether to offer it.
 */
export function SiteManagerSelector({
  project,
  canAssign,
}: {
  project: ProjectDetail;
  canAssign: boolean;
}) {
  const dispatch = useAppDispatch();
  const siteManagers = useAppSelector((state) => state.siteManagers);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const labelId = `${useId()}-site-manager-label`;

  const current = project.siteManager;

  // Nothing is fetched until the list is opened: most visits to a project
  // never reassign it.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void dispatch(
        fetchSiteManagers({ page: 1, limit: PAGE_SIZE, query: search }),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, dispatch, search]);

  const assign = async (manager: { id: string; name: string }) => {
    setOpen(false);
    setSearch("");
    if (manager.id === current?.id) return;

    setSaving(true);
    try {
      const response = await fetchJson<ProjectDetail>(
        `/api/projects/${project.id}/site-manager`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteManagerId: manager.id }),
        },
        "Unable to change the site manager",
      );
      dispatch(setActiveProject(response.data));
      toast.success(`${manager.name} is now the site manager`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to change the site manager",
      );
    } finally {
      setSaving(false);
    }
  };

  const name = current?.name ?? null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-sm text-muted-foreground">
      <HardHat className="size-3.5" aria-hidden="true" />
      <span id={labelId}>Site manager</span>
      {canAssign ? (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={saving}
              aria-labelledby={`${labelId} ${labelId}-value`}
              className="group inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 data-[state=open]:decoration-primary"
            >
              <span
                id={`${labelId}-value`}
                className={name ? undefined : "text-warning-ink"}
              >
                {name ?? "Assign"}
              </span>
              {saving ? (
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden="true"
                />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search site managers..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                {siteManagers.loading && siteManagers.items.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2
                      className="size-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Loading…
                  </div>
                ) : (
                  <CommandEmpty>No site managers found.</CommandEmpty>
                )}
                <CommandGroup>
                  {siteManagers.items.map((manager) => {
                    const role = manager.role;
                    return (
                      <CommandItem
                        key={manager.id}
                        value={manager.id}
                        onSelect={() => void assign(manager)}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">
                            {manager.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[
                              role ? RoleLabelRecord[role] : null,
                              manager.email,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                        {manager.id === current?.id ? (
                          <Check
                            className="ml-2 size-4 shrink-0"
                            aria-label="Current site manager"
                          />
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
              {siteManagers.page < siteManagers.totalPages ? (
                <div className="border-t border-border p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    disabled={siteManagers.loadingMore}
                    onClick={() =>
                      void dispatch(
                        fetchSiteManagers({
                          page: siteManagers.page + 1,
                          limit: PAGE_SIZE,
                          query: search,
                        }),
                      )
                    }
                  >
                    {siteManagers.loadingMore ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="font-medium text-foreground">{name ?? "Not set"}</span>
      )}
    </div>
  );
}
