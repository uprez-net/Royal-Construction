"use client";

import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useLeadSearch } from "@/hooks/useLeadSearch";

/** Search every lead and pick one. A person decides; nothing is guessed. */
export function LeadChooser({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose: (lead: { id: number; name: string }) => void;
}) {
  const leadSearch = useLeadSearch("");

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={leadSearch.query}
          onChange={(event) => leadSearch.setQuery(event.target.value)}
          aria-label="Search leads by name, email or phone"
          placeholder="Search leads by name, email or phone"
          className="pl-8"
        />
      </div>
      {leadSearch.error ? (
        <p className="text-xs text-destructive-ink">{leadSearch.error}</p>
      ) : null}
      {leadSearch.loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />{" "}
          Searching…
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {leadSearch.items.map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose({ id: lead.id, name: lead.name })}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-background disabled:opacity-50"
              >
                <span className="font-medium">{lead.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
          {leadSearch.items.length === 0 && !leadSearch.error ? (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">
              No leads match.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
