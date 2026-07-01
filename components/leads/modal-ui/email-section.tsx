"use client";

import { useState } from "react";
import type { LeadEmails } from "@prisma/client";
import { dataTimeFormat } from "@/utils/formatters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, Mail, Clock3, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadEmailReply } from "./reply-email";
import { LeadEmailComposer } from "./email-composer";


interface LeadEmailSectionProps {
  emails: LeadEmails[];
  leadId: number;
  leadEmail: string;
  appendEmailToLead: (leadId: number, email: LeadEmails) => void;
}

export function LeadEmailSection({
  emails,
  leadId,
  leadEmail,
  appendEmailToLead,
}: LeadEmailSectionProps) {
  const [openItems, setOpenItems] = useState<Record<string, boolean>>(
    emails.reduce(
      (acc, email, index) => ({
        ...acc,
        [email.id]: index === 0, // Expand newest email
      }),
      {},
    ),
  );
  const [isComposing, setIsComposing] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-primary" />
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Lead Emails
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {emails.length} Email{emails.length > 1 ? "s" : ""}
          </Badge>
          <Button
            variant="default"
            size="sm"
            className=" flex items-center gap-1 h-7 px-2 text-xs"
            onClick={() => setIsComposing(true)}
          >
            <Mail className="size-4" />
            Compose Email
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
            <Mail className="mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              No emails recorded
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Incoming emails will automatically appear here.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-137.5 pr-3">
            <div className="space-y-3">
              {emails.map((email) => {
                const isOpen = openItems[email.id];

                return (
                  <Collapsible
                    key={email.id}
                    open={isOpen}
                    onOpenChange={(open) =>
                      setOpenItems((prev) => ({
                        ...prev,
                        [email.id]: open,
                      }))
                    }
                  >
                    <div className="overflow-hidden rounded-xl border bg-background transition-all hover:border-primary/30 hover:shadow-sm">
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-auto w-full justify-start rounded-none p-0 hover:bg-muted/40"
                        >
                          <div className="flex w-full items-start gap-4 p-4 text-left">
                            <ChevronRight
                              className={cn(
                                "mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                                isOpen && "rotate-90",
                              )}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <h4 className="truncate text-sm font-semibold">
                                    {email.subject}
                                  </h4>

                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span className="truncate max-w-45">
                                      {email.emailFrom}
                                    </span>

                                    <ArrowRight className="size-3" />

                                    <span className="truncate max-w-45">
                                      {email.emailTo}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                                  <Clock3 className="size-3" />
                                  {dataTimeFormat.format(email.sentAt)}
                                </div>
                              </div>

                              {!isOpen && (
                                <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                                  {email.body}
                                </p>
                              )}
                            </div>
                          </div>
                        </Button>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <Separator />

                        <div className="bg-muted/20 p-4">
                          <div className="rounded-lg border bg-background p-4">
                            <pre className="whitespace-pre-wrap wrap-break-word font-sans text-sm leading-6 text-foreground">
                              {email.body}
                            </pre>
                            <LeadEmailReply email={email} appendEmailToLead={appendEmailToLead} />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </ScrollArea>
        )}
        {isComposing && (
          <div className="bg-muted/20 p-4">
            <LeadEmailComposer
              leadId={leadId}
              to={leadEmail}
              title={`Compose Email to ${leadEmail}`}
              onSent={() => setIsComposing(false)}
              appendEmailToLead={appendEmailToLead}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
