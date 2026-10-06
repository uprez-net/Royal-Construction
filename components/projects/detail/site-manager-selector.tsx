"use client";

import { useEffect, useId, useState } from "react";
import { HardHat } from "lucide-react";
import { toast } from "sonner";

import {
  SearchableSelect,
  type LookupOption,
} from "@/components/common/searchable-select";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { setActiveProject } from "@/lib/store/slices/projectsSlice";
import { fetchSiteManagers } from "@/lib/store/slices/siteManagersSlice";
import type { ProjectDetail } from "@/types/project";
import { fetchJson } from "@/utils/fetch";

const PAGE_SIZE = 10;

/**
 * The project's site manager, and for an ADMIN the control that reassigns it.
 *
 * Reads the same `/api/site-managers` lookup the create-project wizard uses,
 * so the people offered here are exactly the people a project can be created
 * with. Who may reassign, and who may be assigned, is decided by
 * `assignProjectSiteManager`; `canAssign` only decides whether to show the
 * control.
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
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const labelId = `${useId()}-site-manager-label`;

  const current = project.siteManager;

  useEffect(() => {
    if (!canAssign) return;
    const timer = window.setTimeout(() => {
      void dispatch(
        fetchSiteManagers({ page: 1, limit: PAGE_SIZE, query: search }),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [canAssign, dispatch, search]);

  const assign = async (manager: LookupOption) => {
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

  return (
    <div className="inline-flex items-center gap-1">
      <HardHat className="size-3.5" aria-hidden="true" />
      <span id={labelId}>Site manager</span>{" "}
      {canAssign ? (
        <div className="w-52">
          <SearchableSelect
            label=""
            labelledById={labelId}
            placeholder="Assign manager..."
            searchValue={search}
            selectedItem={current ? { id: current.id, name: current.name } : null}
            items={siteManagers.items}
            loading={saving || siteManagers.loading}
            hasMore={siteManagers.page < siteManagers.totalPages}
            disabled={saving}
            onQueryChange={setSearch}
            onSelect={(item) => void assign(item as LookupOption)}
            onLoadMore={() => {
              void dispatch(
                fetchSiteManagers({
                  page: siteManagers.page + 1,
                  limit: PAGE_SIZE,
                  query: search,
                }),
              );
            }}
          />
        </div>
      ) : (
        <span className="text-foreground">{current?.name ?? "Not set"}</span>
      )}
    </div>
  );
}
