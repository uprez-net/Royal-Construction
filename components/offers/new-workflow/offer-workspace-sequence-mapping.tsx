import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  OFFER_SEQUENCE_MAPPINGS,
  getOfferSequenceMappingStats,
  type OfferSequenceMapping,
} from "@/lib/offer/workspace-sequence-mapping";
import { GitBranch, Link2 } from "lucide-react";
import { OfferCardHeading, OfferSummaryBadge } from "./offer-workspace-card-heading";

const stats = getOfferSequenceMappingStats(OFFER_SEQUENCE_MAPPINGS);

export function SequenceMappingPanel() {
  return (
    <Card
      className="border-border/70 bg-white/95 shadow-sm"
      aria-labelledby="sequence-mapping-title"
    >
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Workbook crosswalk from costing task to building sequence work and customer-visible Offer/Tender wording."
            icon={<GitBranch className="size-4" aria-hidden="true" />}
            singleLineDescription
            title="Offer/Tender Mapping"
            titleId="sequence-mapping-title"
          />
          <div
            className="flex flex-wrap gap-2 text-xs text-muted-foreground"
            aria-label="Offer/Tender mapping summary"
          >
            <OfferSummaryBadge value={stats.totalTasks} label="tasks" />
            <OfferSummaryBadge
              value={stats.sequenceLinkedTasks}
              label="sequence linked"
            />
            <OfferSummaryBadge
              value={stats.projectHandoffTasks}
              label="project handoff"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        <div className="rounded-lg border border-royal-gold/25 bg-royal-gold-light/25 px-3 py-2 text-sm text-muted-foreground">
          Sequence IDs are intentionally hidden. Trade and milestone columns are
          downstream handoff data for Project creation, not customer-facing copy.
          Scroll sideways on small screens.
        </div>
        <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-card">
          <Table className="min-w-[720px] table-fixed border-separate border-spacing-0 text-[13px]">
            <colgroup>
              <col className="w-40" />
              <col className="w-52" />
              <col />
              <col className="w-48" />
            </colgroup>
            <TableCaption className="sr-only">
              Crosswalk showing each costing task, mapped building sequence
              tasks, customer-visible Offer or Tender wording, and downstream
              trade or milestone handoff metadata.
            </TableCaption>
            <TableHeader className="sticky top-0 z-10 bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <MappingHead id="mapping-task-column">Task / phase</MappingHead>
                <MappingHead id="mapping-sequence-column">
                  Building sequence
                </MappingHead>
                <MappingHead id="mapping-wording-column">
                  Offer/Tender wording
                </MappingHead>
                <MappingHead id="mapping-handoff-column">
                  Project handoff
                </MappingHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {OFFER_SEQUENCE_MAPPINGS.map((mapping) => (
                <MappingRow key={mapping.taskName} mapping={mapping} />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function MappingHead({
  children,
  id,
}: {
  readonly children: string;
  readonly id: string;
}) {
  return (
    <TableHead
      className="border-r border-border/70 text-xs uppercase tracking-wide text-muted-foreground last:border-r-0"
      id={id}
    >
      {children}
    </TableHead>
  );
}

function MappingRow({ mapping }: { readonly mapping: OfferSequenceMapping }) {
  return (
    <TableRow className="align-top hover:bg-royal-gold-light/20">
      <TableCell
        className="whitespace-normal break-words border-r border-border/70 bg-background/40 font-medium"
        headers="mapping-task-column"
      >
        {mapping.taskName}
      </TableCell>
      <TableCell
        className="whitespace-normal break-words border-r border-border/70 text-muted-foreground"
        headers="mapping-sequence-column"
      >
        <TextList
          emptyLabel="No scheduled sequence task"
          items={mapping.buildingSequenceTasks}
        />
      </TableCell>
      <TableCell
        className="whitespace-normal break-words border-r border-border/70 leading-5"
        headers="mapping-wording-column"
      >
        {mapping.offerTenderWording}
      </TableCell>
      <TableCell className="whitespace-normal" headers="mapping-handoff-column">
        <HandoffSummary mapping={mapping} />
      </TableCell>
    </TableRow>
  );
}

function TextList({
  emptyLabel,
  items,
}: {
  readonly emptyLabel: string;
  readonly items: readonly string[];
}) {
  if (items.length === 0) {
    return <span className="text-muted-foreground/80">{emptyLabel}</span>;
  }

  return (
    <ul className="grid gap-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Link2
            className="mt-0.5 size-3 shrink-0 text-royal-gold"
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function HandoffSummary({
  mapping,
}: {
  readonly mapping: OfferSequenceMapping;
}) {
  if (mapping.tradesToBook.length === 0 && mapping.milestoneStages.length === 0) {
    return <span className="text-muted-foreground/80">No Project handoff mapping</span>;
  }

  return (
    <div className="grid gap-2">
      <BadgeList items={mapping.tradesToBook} label="Trade" />
      <BadgeList items={mapping.milestoneStages} label="Milestone" />
    </div>
  );
}

function BadgeList({
  items,
  label,
}: {
  readonly items: readonly string[];
  readonly label: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge
          key={`${label}-${item}`}
          className="border-border bg-background font-normal text-muted-foreground"
          variant="outline"
        >
          <span className="sr-only">{label}: </span>
          {item}
        </Badge>
      ))}
    </div>
  );
}

