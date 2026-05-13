import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { leadStages } from "@/lib/mock-data";

export default function LeadsPage() {
  return (
    <SectionCard
      title="Lead pipeline"
      description="This board structure scales from static mockups to real pipeline state."
    >
      <div className="grid gap-4 xl:grid-cols-4">
        {leadStages.map((stage) => (
          <div
            key={stage.title}
            className="rounded-2xl border border-border bg-background p-4 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-base font-semibold">
                {stage.title}
              </h3>
              <Badge variant="secondary" className="rounded-full">
                {stage.count}
              </Badge>
            </div>
            <div className="space-y-3">
              {stage.items.map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
