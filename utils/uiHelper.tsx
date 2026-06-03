import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";

export function SimpleListScreen({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <SectionCard
      title={title}
      description="A lightweight list surface built from the same reusable card and badge primitives."
    >
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item}
            className="flex items-center justify-between rounded-2xl border border-border/70 bg-background p-4"
          >
            <span className="text-sm font-medium">{item}</span>
            <StatusPill tone="neutral">Open</StatusPill>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function getScreenTitle(slug: string) {
  if(!isNaN(parseInt(slug))) {
    return `Creating Offer for Lead #${slug}`;
  }
  if(slug.trim() === "") {
    return "Dashboard";
  }
  const title = slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return title;
}
