"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createColumnHelper,
  createExpandedRowModel,
  rowExpandingFeature,
  tableFeatures,
  useTable,
  type ExpandedState,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileDiff,
  FileText,
  Loader2,
  Mail,
  Plus,
  RotateCw,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  KpiBand,
  MOBILE_METRIC_STRIP_CLASS,
} from "@/components/common/kpi-band";
import { MetricCard } from "@/components/common/metric-card";
import { StatusPill } from "@/components/common/status-pill";
import { CreateVariationModal } from "@/components/projects/create-variation-modal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card } from "@/components/ui/card";
import { DataTableSkeleton, Skeleton } from "@/components/ui/skeleton";
import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_ROW_CLASS,
} from "@/components/ui/table-styles";
import {
  fetchProjectVariations,
  issueVariationAction,
} from "@/lib/data/variation-actions";
import type { VariationListRow } from "@/lib/domain/projects/variation-queries";
import { cn } from "@/lib/utils";
import type { ProjectDetail } from "@/types/project";
import { dateFormat, formatStatus } from "@/utils/formatters";
import type { VariationKind } from "@prisma/client";

const MONEY = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const money = (cents: number) => MONEY.format(cents / 100);
const day = (iso: string) => dateFormat.format(new Date(iso));

function variationsKey(projectId: string) {
  return ["project-variations", projectId] as const;
}

// Who pays decides the colour: green is money the client pays, red is a cost
// the builder carries. The group's own label says the same in words.
const GROUP: Record<
  VariationKind,
  { label: string; hint: string; header: string; row: string; amount: string }
> = {
  CHARGEABLE: {
    amount: "text-success-ink",
    header: "bg-success-light/70 hover:bg-success-light text-success-ink",
    hint: "Invoiced to the client through Xero",
    label: "Paid by the client",
    row: "border-l-2 border-l-success",
  },
  PROMOTIONAL: {
    amount: "text-destructive-ink",
    header:
      "bg-destructive-light/70 hover:bg-destructive-light text-destructive-ink",
    hint: "Covered by Royal Constructions: the client pays nothing",
    label: "Promotional — cost borne by the builder",
    row: "border-l-2 border-l-destructive",
  },
};

type GroupRow = {
  readonly type: "group";
  readonly kind: VariationKind;
  readonly totalCents: number;
  readonly subRows: readonly TableRow[];
};
type VariationRow = {
  readonly type: "variation";
  readonly variation: VariationListRow;
  readonly subRows: readonly TableRow[];
};
type TableRow = GroupRow | VariationRow;

function toRows(variations: readonly VariationListRow[]): TableRow[] {
  return (["CHARGEABLE", "PROMOTIONAL"] as const)
    .map((kind): GroupRow => {
      // Newest first: the one just raised is the one being checked.
      const members = variations
        .filter((variation) => variation.kind === kind)
        .reverse();
      return {
        kind,
        subRows: members.map((variation) => ({
          subRows: [],
          type: "variation",
          variation,
        })),
        totalCents: members
          .filter((variation) => variation.status !== "REJECTED")
          .reduce((total, variation) => total + variation.costCents, 0),
        type: "group",
      };
    })
    .filter((group) => group.subRows.length > 0);
}

export type VariationActions = {
  readonly onRetry: (variation: VariationListRow) => void;
  readonly onResend: (variation: VariationListRow) => void;
  readonly busyId: string | null;
};

// Stable at module scope, as Table v9 asks.
const features = tableFeatures({
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
});

const helper = createColumnHelper<typeof features, TableRow>();

const NUMERIC = "text-right whitespace-nowrap";

function only<T>(
  render: (variation: VariationListRow) => T,
): (props: { row: { original: TableRow } }) => T | null {
  return ({ row }) =>
    row.original.type === "variation" ? render(row.original.variation) : null;
}

function InvoiceCell({ variation }: { variation: VariationListRow }) {
  if (variation.kind === "PROMOTIONAL") {
    return <span className="text-xs text-muted-foreground">No invoice</span>;
  }
  if (variation.legacy) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (!variation.invoiceNumber && !variation.invoiceStatus) {
    return <StatusPill tone="danger">Not raised</StatusPill>;
  }
  const paid = variation.invoiceStatus === "PAID";
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="font-mono text-xs text-foreground">
        {variation.invoiceNumber ?? "Xero"}
      </span>
      <StatusPill
        tone={
          paid
            ? "success"
            : variation.invoiceStatus === "VOIDED"
                || variation.invoiceStatus === "DELETED"
              ? "neutral"
              : "warning"
        }
      >
        {paid ? "Paid" : formatStatus(variation.invoiceStatus ?? "DRAFT")}
      </StatusPill>
    </span>
  );
}

function SentCell({ variation }: { variation: VariationListRow }) {
  if (variation.legacy) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (!variation.sentAt) {
    // A send that failed part-way: some owners have it, and Retry emails
    // only the rest.
    return variation.sentTo.length > 0 ? (
      <span title={`Reached ${variation.sentTo.join(", ")}`}>
        <StatusPill tone="warning">Partly sent</StatusPill>
      </span>
    ) : (
      <StatusPill tone="danger">Not sent</StatusPill>
    );
  }
  return (
    <span
      className="flex flex-col items-start gap-0.5"
      title={variation.sentTo.join(", ")}
    >
      <StatusPill tone="success">Sent</StatusPill>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {day(variation.sentAt)}
      </span>
    </span>
  );
}

function columnsFor(actions: VariationActions) {
  return helper.columns([
    helper.display({
      id: "number",
      header: "No.",
      cell: only((variation) => (
        <span className="font-mono text-sm font-medium text-foreground">
          {variation.number}
        </span>
      )),
    }),
    helper.display({
      id: "activity",
      header: "Activity and reason",
      cell: only((variation) => (
        <span className="block min-w-0">
          <span className="block font-medium text-foreground">
            {variation.activityName ?? "No activity"}
            {variation.stageLabel ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {variation.stageLabel}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {variation.reason}
          </span>
          {variation.issueError ? (
            <span className="mt-1 flex items-start gap-1 text-xs font-medium text-destructive-ink">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              {variation.issueError}
            </span>
          ) : null}
        </span>
      )),
    }),
    helper.display({
      id: "price",
      header: "Price (ex GST)",
      cell: only((variation) =>
        variation.previousPriceCents === null
        || variation.newPriceCents === null ? (
          <span className="text-xs text-muted-foreground">Not priced</span>
        ) : (
          <span className="flex flex-col items-end font-mono text-sm tabular-nums">
            <span className="text-muted-foreground line-through">
              {money(variation.previousPriceCents)}
            </span>
            <span className="text-foreground">
              {money(variation.newPriceCents)}
            </span>
          </span>
        ),
      ),
    }),
    helper.display({
      id: "amount",
      header: "Variation",
      cell: only((variation) => (
        <span
          className={cn(
            "font-mono text-sm font-medium tabular-nums",
            variation.status === "REJECTED"
              ? "text-muted-foreground line-through"
              : GROUP[variation.kind].amount,
          )}
        >
          +{money(variation.costCents)}
        </span>
      )),
    }),
    helper.display({
      id: "client",
      header: "Client pays",
      cell: only((variation) => (
        <span className="font-mono text-sm tabular-nums text-foreground">
          {money(variation.chargeIncGstCents)}
          <span className="block text-xs text-muted-foreground">inc GST</span>
        </span>
      )),
    }),
    helper.display({
      id: "raised",
      header: "Raised",
      cell: only((variation) => (
        <span className="flex flex-col">
          <span className="font-mono text-sm tabular-nums text-foreground">
            {day(variation.raisedDate)}
          </span>
          {variation.raisedByName ? (
            <span className="text-xs text-muted-foreground">
              {variation.raisedByName}
            </span>
          ) : null}
          {variation.status !== "APPROVED" ? (
            <span className="mt-1">
              <StatusPill
                tone={variation.status === "REJECTED" ? "neutral" : "warning"}
              >
                {formatStatus(variation.status)}
              </StatusPill>
            </span>
          ) : null}
        </span>
      )),
    }),
    helper.display({
      id: "invoice",
      header: "Xero invoice",
      cell: only((variation) => <InvoiceCell variation={variation} />),
    }),
    helper.display({
      id: "sent",
      header: "Client email",
      cell: only((variation) => <SentCell variation={variation} />),
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: only((variation) => {
        const busy = actions.busyId === variation.id;
        return (
          <span className="flex items-center justify-end gap-1">
            {variation.documentUrl ? (
              <Button asChild variant="ghost" size="sm">
                <a
                  href={variation.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open the ${variation.number} document`}
                >
                  <FileText className="size-4" aria-hidden="true" />
                  PDF
                </a>
              </Button>
            ) : null}
            {variation.needsAttention ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => actions.onRetry(variation)}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCw className="size-4" aria-hidden="true" />
                )}
                Retry
              </Button>
            ) : !variation.legacy && variation.status === "APPROVED" ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => actions.onResend(variation)}
                aria-label={`Email ${variation.number} to the client again`}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="size-4" aria-hidden="true" />
                )}
                Resend
              </Button>
            ) : null}
          </span>
        );
      }),
    }),
  ]);
}

const COLUMN_CLASS: Record<string, string> = {
  actions: "text-right w-0 whitespace-nowrap",
  activity: "min-w-64",
  amount: NUMERIC,
  client: NUMERIC,
  invoice: "whitespace-nowrap",
  number: "w-0 whitespace-nowrap",
  price: NUMERIC,
  raised: "whitespace-nowrap",
  sent: "whitespace-nowrap",
};

/**
 * Every variation on the project, grouped by who pays: the client (green) or
 * the builder (red). It loads its own data, like the Financials tab, because
 * a variation's invoice is paid through the Xero webhook and its email can be
 * retried here — neither reaches the project page's cache.
 */
export function ProjectVariationsTab({ project }: { project: ProjectDetail }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <VariationsTab projectId={project.id} />
    </QueryClientProvider>
  );
}

function VariationsTab({ projectId }: { projectId: string }) {
  "use no memo";
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: variationsKey(projectId),
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      const result = await fetchProjectVariations(projectId);
      if (!result.ok) throw new Error(result.error);
      return result.report;
    },
  });

  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resending, setResending] = useState<VariationListRow | null>(null);
  const [expanded, setExpanded] = useState<ExpandedState>(true);

  async function issue(variation: VariationListRow, resend: boolean) {
    setBusyId(variation.id);
    try {
      const result = await issueVariationAction({
        attemptKey: crypto.randomUUID(),
        projectId,
        // A resend goes to whoever it went to before, as the confirmation
        // says; a retry finishes with every owner.
        recipients:
          resend && variation.sentTo.length > 0
            ? [...variation.sentTo]
            : undefined,
        resend,
        variationId: variation.id,
      });
      if (!result.ok) {
        toast.error(`${variation.number} did not go out.`, {
          description: result.error,
          duration: 12_000,
        });
      } else {
        toast.success(
          result.issued.emailedTo.length
            ? `${result.issued.number} sent to ${result.issued.emailedTo.join(", ")}.`
            : `${result.issued.number} is up to date.`,
        );
      }
    } catch {
      toast.error(
        `${variation.number} could not be sent. Check its status before trying again.`,
      );
    } finally {
      setBusyId(null);
      await queryClient.invalidateQueries({
        queryKey: variationsKey(projectId),
      });
    }
  }

  const actions: VariationActions = {
    busyId,
    onResend: (variation) => setResending(variation),
    onRetry: (variation) => void issue(variation, false),
  };
  const columns = useMemo(() => columnsFor(actions), [busyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(
    () => (query.data ? toRows(query.data.rows) : []),
    [query.data],
  );
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) =>
      row.type === "group" ? `group-${row.kind}` : row.variation.id,
    getSubRows: (row) => [...row.subRows],
    getRowCanExpand: (row) => row.original.type === "group",
    state: { expanded },
    onExpandedChange: setExpanded,
  });

  if (query.isPending) return <VariationsSkeleton />;
  if (query.isError || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Variations could not be loaded</AlertTitle>
        <AlertDescription>
          <p>{query.error?.message ?? "Something went wrong."}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const { summary, rows: variations } = query.data;
  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-4">
      <KpiBand
        className={cn(
          MOBILE_METRIC_STRIP_CLASS,
          "sm:grid-cols-2 xl:grid-cols-4",
        )}
      >
        <MetricCard
          title="Variations raised"
          value={summary.count}
          caption={`${money(summary.chargeable.cents + summary.promotional.cents)} in price changes`}
        />
        <MetricCard
          title="Billed to the client"
          value={money(summary.chargeable.cents)}
          caption={`${summary.chargeable.count} paid by the client · ex GST`}
        />
        <MetricCard
          title="Cost borne by the builder"
          value={money(summary.promotional.cents)}
          caption={`${summary.promotional.count} promotional · ex GST`}
        />
        <MetricCard
          title="Awaiting payment"
          value={money(summary.awaitingPaymentCents)}
          caption="Invoiced in Xero, inc GST"
        />
      </KpiBand>

      {summary.needsAttention > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>
            {summary.needsAttention === 1
              ? "1 variation has not fully reached the client"
              : `${summary.needsAttention} variations have not fully reached the client`}
          </AlertTitle>
          <AlertDescription>
            An invoice, document or email did not go out. Each is marked below
            with what went wrong; Retry finishes only what is left.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-0 overflow-hidden bg-card py-0 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
          <div>
            <h3 className="font-heading text-lg font-semibold text-foreground">
              Variation log
            </h3>
            <p className="text-sm text-muted-foreground">
              Prices are ex GST. What the client pays includes GST.
            </p>
          </div>
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Create variation
          </Button>
        </div>

        {variations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <FileDiff
              className="size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="font-medium text-foreground">No variations yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Raise one here, or from an activity on the Financials or
              Milestones tab.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full caption-bottom text-[13px]">
              <caption className="sr-only">
                Variations, grouped by who pays for them
              </caption>
              <thead className={TABLE_HEAD_ROW_CLASS}>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className={cn(
                          TABLE_HEAD_CELL_CLASS,
                          COLUMN_CLASS[header.column.id],
                        )}
                      >
                        {header.isPlaceholder ? null : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => {
                  const original = row.original;
                  if (original.type === "group") {
                    const style = GROUP[original.kind];
                    const open = row.getIsExpanded();
                    return (
                      <tr
                        key={row.id}
                        className={cn(TABLE_ROW_CLASS, style.header)}
                      >
                        <td colSpan={columns.length} className="p-0">
                          <button
                            type="button"
                            onClick={row.getToggleExpandedHandler()}
                            aria-expanded={open}
                            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                          >
                            {open ? (
                              <ChevronDown
                                className="size-4"
                                aria-hidden="true"
                              />
                            ) : (
                              <ChevronRight
                                className="size-4"
                                aria-hidden="true"
                              />
                            )}
                            <span className="font-semibold">{style.label}</span>
                            <span className="text-xs opacity-80">
                              {original.subRows.length} · {style.hint}
                            </span>
                            <span className="ml-auto font-mono font-semibold tabular-nums">
                              +{money(original.totalCents)}
                            </span>
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={cn(
                          TABLE_ROW_CLASS,
                          GROUP[original.variation.kind].row,
                          original.variation.needsAttention
                            && "bg-destructive-light/30",
                        )}
                      >
                        {row.getAllCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={cn(
                              TABLE_CELL_CLASS,
                              "align-top",
                              COLUMN_CLASS[cell.column.id],
                            )}
                          >
                            <table.FlexRender cell={cell} />
                          </td>
                        ))}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateVariationModal
        projectId={projectId}
        open={creating}
        onOpenChange={setCreating}
        onSuccess={() =>
          void queryClient.invalidateQueries({
            queryKey: variationsKey(projectId),
          })
        }
      />

      <AlertDialog
        open={resending !== null}
        onOpenChange={(open) => {
          if (!open) setResending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Email {resending?.number} to the client again?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The same document goes to{" "}
              {resending?.sentTo.length
                ? resending.sentTo.join(", ")
                : "every owner on the contract"}
              . No new Xero invoice is raised.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (resending) void issue(resending, true);
                setResending(null);
              }}
            >
              Resend email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VariationsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading variations">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[76px] rounded-lg" />
        ))}
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>
        {/* Mirrors the variation table: nine columns, a band, flush in the card. */}
        <DataTableSkeleton columnCount={9} mobileLayout="scroll" flush />
      </Card>
    </div>
  );
}
