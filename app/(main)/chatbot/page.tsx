import { SectionCard } from "@/components/common/section-card";


export default function ChatbotPage() {
  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr_280px]">
      <SectionCard
        title="Customers"
        description="The conversation sidebar is a reusable list and detail pattern."
      >
        <div className="space-y-2">
          {["Harpreet Kaur", "Rajesh Kumar", "Wei Zhang"].map((name) => (
            <div
              key={name}
              className="rounded-xl border border-border/70 bg-background p-3 text-sm font-medium"
            >
              {name}
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard
        title="Conversation"
        description="Chat bubbles and quote cards can be embedded into this pane."
      >
        <div className="space-y-3 rounded-3xl bg-muted/20 p-4">
          <div className="max-w-[78%] rounded-2xl rounded-tl-sm bg-background p-4 text-sm shadow-sm">
            Can you send the revised quote with 4% discount?
          </div>
          <div className="ml-auto max-w-[78%] rounded-2xl rounded-tr-sm bg-teal-600 p-4 text-sm text-white shadow-sm">
            Drafting now. I’ll attach the updated approval flow.
          </div>
        </div>
      </SectionCard>
      <SectionCard
        title="Settings"
        description="Escalations, reminders, and response preferences belong here."
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Auto-reply enabled</p>
          <p>Escalate after 10 min</p>
          <p>Attach quote summary on approval</p>
        </div>
      </SectionCard>
    </div>
  );
}
