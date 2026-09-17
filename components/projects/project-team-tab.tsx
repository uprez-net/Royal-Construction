import { BadgeCheck, Mail, Phone, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProjectWithStats } from "@/types/project";

interface TeamTabProps {
  project: ProjectWithStats;
}

export function TeamTab({ project }: TeamTabProps) {
  const siteManager = project.siteManager;
  const managerPhone = siteManager?.phone?.trim();
  const managerEmail = siteManager?.email?.trim();
  const managerTelHref = managerPhone
    ? `tel:${managerPhone.replace(/\s+/g, "")}`
    : null;

  return (
    <div className="space-y-4">
      {/* Site manager — the only real team data on this project record. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <BadgeCheck aria-hidden="true" className="h-4 w-4 text-primary" />
            Site manager
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {siteManager ? (
            <>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {siteManager.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Responsible for milestone photo uploads, tradie coordination
                  and daily site updates at {project.location}.
                </p>
              </div>

              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Phone
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {managerPhone && managerTelHref ? (
                      <a
                        href={managerTelHref}
                        className="font-mono tabular-nums underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {managerPhone}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">
                        Not recorded
                      </span>
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Email
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {managerEmail ? (
                      <a
                        href={`mailto:${managerEmail}`}
                        className="break-all underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {managerEmail}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">
                        Not recorded
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                {managerEmail ? (
                  <Button asChild variant="outline" size="lg">
                    <a href={`mailto:${managerEmail}`}>
                      <Mail aria-hidden="true" />
                      Email {siteManager.name}
                    </a>
                  </Button>
                ) : null}

                {managerTelHref ? (
                  <Button asChild variant="outline" size="lg">
                    <a href={managerTelHref}>
                      <Phone aria-hidden="true" />
                      Call
                    </a>
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No site manager is assigned to this project yet. Assign one from
              the project settings to route site updates and tradie
              coordination.
            </p>
          )}
        </CardContent>
      </Card>

      {/*
        Worker attendance is not wired to this project. The previous version
        rendered an always-empty worker roster with a hardcoded "Frame Stage",
        a permanently green "Checked In" badge, a "0 hrs" weekly total and a
        "GPS-tracked via site QR code" claim — none of which came from data.
      */}
      <Card className="border border-dashed border-border/70 shadow-sm ring-0">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Users
              aria-hidden="true"
              className="h-6 w-6 text-muted-foreground"
            />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">
              Attendance tracking is not enabled for this project
            </h3>

            <p className="mx-auto max-w-prose text-sm text-muted-foreground">
              Once site check-in is enabled, the workers assigned to{" "}
              {project.location} and their hours for the week will be listed
              here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
