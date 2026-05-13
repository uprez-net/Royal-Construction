import { SectionCard } from "@/components/common/section-card";

export default function MilestonesPage() {
  return (
    <SectionCard
      title="Milestones"
      description="A reusable timeline layout captures progress, dependencies, and delays."
    >
      <div className="space-y-4 border-l border-border pl-5">
        {[
          ["Site preparation", "done"],
          ["Frame erection", "done"],
          ["Roof installation", "current"],
          ["Fit-out", "pending"],
        ].map(([label, status]) => (
          <div key={label} className="relative">
            <div
              className={`absolute top-1 size-3 rounded-full border-2 border-background shadow ${
                status === "done"
                  ? "bg-emerald-500"
                  : status === "current"
                    ? "bg-teal-500"
                    : "bg-slate-400"
              }`}
              style={{ left: "-1.55rem" }}
            />
            <p className="font-medium">{label}</p>
            <p className="text-sm text-muted-foreground capitalize">{status}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
