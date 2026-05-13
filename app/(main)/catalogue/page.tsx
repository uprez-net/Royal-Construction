import { SectionCard } from "@/components/common/section-card";

export default function DashboardPage() {
  return (
    <SectionCard
      title="Material catalogue"
      description="Cards, selection states, and quote generation share one material card component."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Roofing", "18 products"],
          ["Joinery", "24 products"],
          ["Bathroom", "12 products"],
          ["Outdoor", "9 products"],
        ].map(([title, count]) => (
          <div
            key={title}
            className="rounded-2xl border border-border/70 bg-background p-5 shadow-sm"
          >
            <p className="font-heading text-lg font-semibold">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{count}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              Supplier pricing, stock, and variation flags can live here.
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
