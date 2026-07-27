import { MessageSquare } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectDetail } from "@/types/project";

interface ProjectCommunicationTabsProps {
  project: ProjectDetail;
}

/**
 * Project communications.
 *
 * This panel previously rendered a searchable table over `const communications:
 * CommunicationEntry[] = []` — a hardcoded empty array with no data source, plus
 * a "Send Message" button with no handler and a search box that filtered
 * nothing. There is no project-level message or email model in the schema
 * (`ChatMessage`, `EmailAdHock` and `LeadEmails` are all lead-scoped), so the
 * table, the search and the dead button are gone and the panel states plainly
 * what is not available here. Restore the table when a project communications
 * model exists to back it.
 */
export function ProjectCommunicationTabs({}: ProjectCommunicationTabsProps) {
  return (
    <Card className="rounded-xl border-border/70 bg-card shadow-sm">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle as="h2" className="text-base font-semibold text-foreground">
          Communications
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-5">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-8 text-center">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
            <MessageSquare
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </div>

          <p className="text-base font-semibold text-foreground">
            Project messaging is not enabled
          </p>

          <p className="text-sm text-muted-foreground">
            Messages, emails and call notes are not stored against a project, so
            there is no thread to show here. Calls logged against a tradie
            booking appear on the Tradies tab, and every recorded action appears
            on the History tab.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
