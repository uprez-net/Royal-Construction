"use client";

import { StatusPill } from "@/components/common/status-pill";

import { useId, useState, useTransition, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Check,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { DataTable } from "@/components/common/data-table";
import { ListToolbar, TableCard } from "@/components/common/list-toolbar";
import { TradeIconGlyph } from "@/components/tradie-management/trade-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { loadTradeTypes } from "@/hooks/use-trade-types";
import {
  createTradeTypeAction,
  deleteTradeTypeAction,
  setTradeTypeArchivedAction,
  updateTradeTypeAction,
  type TradeTypeActionResult,
} from "@/lib/actions/trade-types";
import type { TradeIconKey, TradeTypeAdminRow } from "@/types/trade-type";
import { IconPicker } from "./trade-icon-picker";

const DEFAULT_ICON: TradeIconKey = "hard-hat";

const LOCKED_REASON =
  "The Compliance tab finds its contacts by this name, so it can't be renamed, archived or deleted. The icon can still change.";

export function TradeTypesAdmin({
  tradeTypes,
}: {
  tradeTypes: TradeTypeAdminRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TradeTypeAdminRow | null>(
    null,
  );
  const archivedCount = tradeTypes.filter((row) => row.archived).length;
  const visible = tradeTypes.filter((row) => showArchived || !row.archived);

  /**
   * Run one write. On success the server rows are re-read (router.refresh)
   * and the pickers' shared list is reloaded, so this tab sees the change in
   * every picker at once. Resolves true when the write landed.
   */
  const submit = (
    write: () => Promise<TradeTypeActionResult>,
    success: (result: Extract<TradeTypeActionResult, { ok: true }>) => string,
  ) =>
    new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await write();
        if (!result.ok) {
          toast.error(result.error);
          resolve(false);
          return;
        }
        toast.success(success(result));
        await loadTradeTypes(true);
        router.refresh();
        resolve(true);
      });
    });

  const rows = visible.map((row) =>
    row.id === editingId
      ? editRow(row)
      : [
          <TradeIconGlyph
            key={`icon-${row.id}`}
            icon={row.icon}
            className="size-4 text-muted-foreground"
          />,
          <span
            key={`label-${row.id}`}
            className="inline-flex items-center gap-2 font-medium"
          >
            {row.label}
            {row.locked ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="inline-flex text-muted-foreground"
                    aria-label="Used by the Compliance tab"
                  >
                    <Lock className="size-3.5" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {LOCKED_REASON}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </span>,
          <span key={`count-${row.id}`} className="font-mono tabular-nums">
            {row.tradieCount}
          </span>,
          row.archived ? (
            <StatusPill key={`status-${row.id}`} tone="neutral">
              Archived
            </StatusPill>
          ) : (
            <StatusPill key={`status-${row.id}`} tone="success">
              In use
            </StatusPill>
          ),
          <div key={`actions-${row.id}`} className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 md:min-h-0"
              disabled={isPending}
              onClick={() => setEditingId(row.id)}
              aria-label={`Edit ${row.label}`}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
            {row.archived ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 md:min-h-0"
                disabled={isPending}
                onClick={() =>
                  void submit(
                    () =>
                      setTradeTypeArchivedAction({
                        id: row.id,
                        archived: false,
                      }),
                    () => `${row.label} is back in the trade pickers.`,
                  )
                }
                aria-label={`Restore ${row.label}`}
              >
                <ArchiveRestore className="size-4" aria-hidden="true" />
                Restore
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 md:min-h-0"
                disabled={isPending || row.locked}
                title={row.locked ? LOCKED_REASON : undefined}
                onClick={() =>
                  void submit(
                    () =>
                      setTradeTypeArchivedAction({
                        id: row.id,
                        archived: true,
                      }),
                    () =>
                      row.tradieCount > 0
                        ? `${row.label} is archived. Its ${row.tradieCount} ${row.tradieCount === 1 ? "tradie keeps" : "tradies keep"} it.`
                        : `${row.label} is archived.`,
                  )
                }
                aria-label={`Archive ${row.label}`}
              >
                <Archive className="size-4" aria-hidden="true" />
                Archive
              </Button>
            )}
            {/* Only a trade nobody holds can go; the rest are archived, so
                the tradies under them keep their history. */}
            {!row.locked && row.tradieCount === 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => setPendingDelete(row)}
                aria-label={`Delete ${row.label}`}
                className="min-h-11 text-destructive hover:text-destructive md:min-h-0"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>,
        ],
  );

  function editRow(row: TradeTypeAdminRow) {
    return [
      null,
      <EditTradeType
        key={`edit-${row.id}`}
        row={row}
        disabled={isPending}
        onCancel={() => setEditingId(null)}
        onSave={async (changes) => {
          const saved = await submit(
            () => updateTradeTypeAction({ id: row.id, ...changes }),
            (result) =>
              result.tradiesRenamed
                ? `Renamed. ${result.tradiesRenamed} ${result.tradiesRenamed === 1 ? "tradie moved" : "tradies moved"} to ${changes.label}.`
                : "Saved.",
          );
          if (saved) setEditingId(null);
        }}
      />,
      <span key={`count-${row.id}`} className="font-mono tabular-nums">
        {row.tradieCount}
      </span>,
      null,
      null,
    ];
  }

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {archivedCount > 0 ? (
          <ListToolbar>
            <div className="flex min-h-11 items-center gap-2">
              <Switch
                id="show-archived-trades"
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
              <Label htmlFor="show-archived-trades" className="text-sm">
                Show archived ({archivedCount})
              </Label>
            </div>
          </ListToolbar>
        ) : null}

        <TableCard
          header={
            <AddTradeType
              disabled={isPending}
              onAdd={(label, icon) =>
                submit(
                  () => createTradeTypeAction({ label, icon }),
                  () => `${label} added.`,
                )
              }
            />
          }
        >
          <div className="p-4 sm:p-5 md:p-0">
            <DataTable
              flush
              mobileLayout="cards"
              mobileColumns={1}
              mobileTitleColumn={1}
              headers={["", "Trade", "Tradies", "Status", ""]}
              align={["start", "start", "end", "start", "end"]}
              caption="Trades a tradie can be listed under, with how many tradies each holds."
              rows={rows}
            />
          </div>
        </TableCard>

        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {pendingDelete?.label}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                No tradie is listed under it, so nothing else changes. You can
                add it again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                onClick={() => {
                  const row = pendingDelete;
                  if (!row) return;
                  void submit(
                    () => deleteTradeTypeAction({ id: row.id }),
                    () => `${row.label} deleted.`,
                  );
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

function AddTradeType({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (label: string, icon: TradeIconKey) => Promise<boolean>;
}) {
  const inputId = useId();
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState<TradeIconKey>(DEFAULT_ICON);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!label.trim() || disabled) return;
    if (await onAdd(label.trim(), icon)) {
      setLabel("");
      setIcon(DEFAULT_ICON);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor={inputId}>New trade</Label>
        <Input
          id={inputId}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Lighting"
          maxLength={60}
          disabled={disabled}
        />
      </div>
      <IconPicker value={icon} onChange={setIcon} disabled={disabled} />
      <Button
        type="submit"
        disabled={disabled || !label.trim()}
        className="min-h-11 md:min-h-0"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add trade
      </Button>
    </form>
  );
}

function EditTradeType({
  row,
  disabled,
  onCancel,
  onSave,
}: {
  row: TradeTypeAdminRow;
  disabled: boolean;
  onCancel: () => void;
  onSave: (changes: { label?: string; icon: TradeIconKey }) => Promise<void>;
}) {
  const inputId = useId();
  const [label, setLabel] = useState(row.label);
  const [icon, setIcon] = useState<TradeIconKey>(row.icon);
  const renamed = label.trim() !== row.label;

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim()) return;
        void onSave({ icon, ...(renamed ? { label: label.trim() } : {}) });
      }}
    >
      <IconPicker value={icon} onChange={setIcon} disabled={disabled} compact />
      <Label htmlFor={inputId} className="sr-only">
        Trade name
      </Label>
      <Input
        id={inputId}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        maxLength={60}
        disabled={disabled || row.locked}
        title={row.locked ? LOCKED_REASON : undefined}
        className="h-9 min-w-40 flex-1"
        autoFocus
      />
      <Button
        type="submit"
        size="sm"
        className="min-h-11 md:min-h-0"
        disabled={disabled || !label.trim()}
        aria-label="Save"
      >
        <Check className="size-4" aria-hidden="true" />
        Save
      </Button>
      <Button
        type="button"
        size="sm"
        className="min-h-11 md:min-h-0"
        variant="ghost"
        onClick={onCancel}
        disabled={disabled}
        aria-label="Cancel"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
      {renamed && row.tradieCount > 0 ? (
        <p className="w-full text-xs text-muted-foreground">
          {row.tradieCount} {row.tradieCount === 1 ? "tradie" : "tradies"} will
          move to the new name.
        </p>
      ) : null}
    </form>
  );
}
