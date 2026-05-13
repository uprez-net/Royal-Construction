import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";

export default function QuoteDetailsPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <SectionCard
        title="Quote details"
        description="Document preview, line items, and approval state live in one composable shell."
      >
        <div className="rounded-3xl border border-border bg-muted/20 p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                BuildPro quote
              </p>
              <h3 className="font-heading text-2xl font-semibold">QT-204</h3>
            </div>
            <StatusPill tone="success">Ready to sign</StatusPill>
          </div>
          <div className="mt-5 space-y-3 text-sm text-muted-foreground">
            <p>Client: Harpreet Kaur</p>
            <p>Project: Penrith Residence</p>
            <p>
              Line items, taxes, and variations are structured as mapped rows
              rather than copied HTML.
            </p>
          </div>
        </div>
      </SectionCard>
      <SectionCard
        title="Actions"
        description="These map directly to Clerk-aware, production-ready workflows."
      >
        <div className="space-y-3">
          <Button className="w-full">Approve quote</Button>
          <Button variant="outline" className="w-full">
            Request variation
          </Button>
          <Button variant="secondary" className="w-full">
            Upload signed copy
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
