import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  CircleSlash,
  KeyRound,
  Link2,
  Phone,
  ShieldCheck,
  Webhook,
} from "lucide-react";

import { CopyButton } from "@/components/common/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { WhatsAppBadgeIcon } from "@/components/whatsapp/whatsapp-logo";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import type { WhatsAppOperationalCounts } from "@/lib/domain/integrations/whatsapp";
import { cn } from "@/lib/utils";
import type {
  WhatsAppAdminConfig,
  WhatsAppMetaHealth,
} from "@/lib/whatsapp/admin-status";

// Admin › WhatsApp: how this deployment's WhatsApp is set up, read-only.
// Secrets are only ever "set" or "not set"; nothing here can change them —
// they are deployment variables (docs/whatsapp-runbook.md).

function Section({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: typeof Phone;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e7fce3] text-[#008069]">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SetFlag({ set, label }: { set: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
          set
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
            : "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
        )}
      >
        {set ? (
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
        ) : (
          <CircleSlash className="size-3.5" aria-hidden="true" />
        )}
        {set ? "Set" : "Not set"}
      </span>
    </li>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        tone === "warning" && Number(value) > 0
          ? "border-amber-200 bg-amber-50/60"
          : "border-border/70 bg-background",
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function WhatsAppStatusPanel({
  config,
  counts,
}: {
  config: WhatsAppAdminConfig;
  counts: WhatsAppOperationalCounts;
}) {
  const healthy =
    config.enabled
    && config.numbers.length > 0
    && config.secrets.accessToken
    && config.secrets.appSecret
    && config.secrets.verifyToken
    && config.problems.length === 0;
  const status = !config.enabled
    ? { label: "Off", tone: "bg-muted text-muted-foreground ring-border" }
    : healthy
      ? {
          label: "Connected",
          tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        }
      : {
          label: "Needs attention",
          tone: "bg-amber-50 text-amber-800 ring-amber-200",
        };
  const defaultNumber = config.numbers.find((number) => number.isDefault);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="relative flex flex-wrap items-center gap-4 bg-linear-to-br from-[#f0fdf4] via-white to-[#ecfdf5] p-6">
          <WhatsAppBadgeIcon className="size-12" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              WhatsApp Business
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {defaultNumber
                ? `Connected through ${defaultNumber.label} · ${formatE164ForDisplay(defaultNumber.displayNumber)}`
                : config.enabled
                  ? "No business number is configured yet."
                  : "WhatsApp is turned off for this deployment (WHATSAPP_ENABLED)."}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1",
              status.tone,
            )}
          >
            {status.label}
          </span>
        </div>
        <div className="grid gap-3 border-t border-border/70 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Lead conversations" value={counts.leadConversations} />
          <Stat
            label="Project groups"
            value={counts.projectGroups.ACTIVE}
            hint={
              counts.projectGroups.CREATING || counts.projectGroups.FAILED
                ? `${counts.projectGroups.CREATING} creating · ${counts.projectGroups.FAILED} failed`
                : "active"
            }
          />
          <Stat
            label="Files saved"
            value={counts.media.STORED}
            hint={`${counts.media.PENDING} waiting · ${counts.media.FAILED} failed`}
          />
          <Stat
            label="Waiting for a person"
            value={
              counts.unmatchedPending
              + counts.needsReconciliation
              + counts.unlinkedGroupMessages
            }
            hint={`${counts.unmatchedPending} unmatched · ${counts.needsReconciliation} unconfirmed · ${counts.unlinkedGroupMessages} in unlinked groups`}
            tone="warning"
          />
        </div>
      </div>

      {config.problems.length > 0 ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Configuration problems
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {config.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          icon={Phone}
          title="Business numbers"
          description="The numbers customers and owners see. Outreach starts from the default."
        >
          {config.numbers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No numbers configured. Set WHATSAPP_PHONE_NUMBERS.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {config.numbers.map((number) => (
                <li
                  key={number.phoneNumberId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      {number.label}
                      {number.isDefault ? (
                        <span className="rounded-full bg-[#e7fce3] px-2 py-0.5 text-[11px] font-semibold text-[#008069]">
                          Default
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {formatE164ForDisplay(number.displayNumber)}
                    </p>
                  </div>
                  <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                    ID {number.phoneNumberId}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          icon={Webhook}
          title="Webhook"
          description="Where Meta delivers messages, delivery ticks and group events."
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Callback URL
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-border/70 bg-muted/50 px-3 py-2 font-mono text-xs text-foreground">
                  {config.webhook.callbackUrl
                    ?? `https://<app host>${config.webhook.path}`}
                </code>
                {config.webhook.callbackUrl ? (
                  <CopyButton
                    value={config.webhook.callbackUrl}
                    iconOnly
                    label="Copy callback URL"
                    successToast="Callback URL copied."
                  />
                ) : null}
              </div>
              {!config.webhook.callbackUrl ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Set NEXT_PUBLIC_APP_URL to show the full address.
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Subscribed fields needed
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {config.webhook.fields.map((field) => (
                  <code
                    key={field}
                    className="rounded-full bg-[#e7fce3] px-2.5 py-1 font-mono text-[11px] text-[#005c4b]"
                  >
                    {field}
                  </code>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-border/70 border-t border-border/70">
              <SetFlag label="Verify token" set={config.secrets.verifyToken} />
              <SetFlag
                label="App secret (signature check)"
                set={config.secrets.appSecret}
              />
              <SetFlag label="Access token" set={config.secrets.accessToken} />
            </ul>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Business account
                </dt>
                <dd className="font-mono text-xs">
                  {config.businessAccountId ?? "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Graph API</dt>
                <dd className="font-mono text-xs">{config.apiVersion}</dd>
              </div>
            </dl>
          </div>
        </Section>

        <Section
          icon={ShieldCheck}
          title="Features"
          description="What this deployment does with WhatsApp."
          className="lg:col-span-2"
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {config.features.map((feature) => (
              <li
                key={feature.key}
                className={cn(
                  "flex gap-3 rounded-xl border p-4",
                  feature.enabled
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-border/70 bg-muted/30",
                )}
              >
                {feature.enabled ? (
                  <CheckCircle2
                    className="mt-0.5 size-4.5 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleSlash
                    className="mt-0.5 size-4.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {feature.label}
                    <span className="sr-only">
                      {feature.enabled ? " (on)" : " (off)"}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {feature.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {config.templates.length > 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Templates enabled:{" "}
              {config.templates.map((name, index) => (
                <span key={name}>
                  {index > 0 ? ", " : ""}
                  <code className="font-mono">{name}</code>
                </span>
              ))}
            </p>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

const QUALITY_TONE: Record<string, string> = {
  GREEN: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  RED: "bg-rose-50 text-rose-700 ring-rose-200",
  YELLOW: "bg-amber-50 text-amber-800 ring-amber-200",
};

export function WhatsAppMetaHealthPanel({
  health,
}: {
  health: WhatsAppMetaHealth | null;
}) {
  return (
    <Section
      icon={BadgeCheck}
      title="What Meta reports"
      description={
        health
          ? `Checked live at ${health.checkedAt.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" })}. Reload the page to check again.`
          : "Needs WhatsApp turned on with an access token."
      }
    >
      {!health ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing to check yet.
        </p>
      ) : (
        <div className="space-y-4">
          <ul className="grid gap-3 lg:grid-cols-2">
            {health.numbers.map((number) => (
              <li
                key={number.phoneNumberId}
                className="rounded-xl border border-border/70 p-4"
              >
                {number.ok ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {number.verifiedName ?? "Unnamed"}
                      </p>
                      {number.qualityRating ? (
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1",
                            QUALITY_TONE[number.qualityRating]
                              ?? "bg-muted text-muted-foreground ring-border",
                          )}
                        >
                          Quality {number.qualityRating.toLowerCase()}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {number.displayPhoneNumber}
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Official Business Account
                        </dt>
                        <dd
                          className={cn(
                            "font-medium",
                            number.officialBusinessAccount
                              ? "text-emerald-700"
                              : "text-amber-800",
                          )}
                        >
                          {number.officialBusinessAccount === null
                            ? "Unknown"
                            : number.officialBusinessAccount
                              ? "Yes — groups available"
                              : "No — groups unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Messaging limit
                        </dt>
                        <dd className="font-medium">
                          {number.messagingLimitTier ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Display name
                        </dt>
                        <dd className="font-medium">
                          {number.nameStatus ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          Platform
                        </dt>
                        <dd className="font-medium">
                          {number.platformType ?? "—"}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="flex items-start gap-2 text-sm text-destructive-ink">
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Number {number.phoneNumberId}: {number.error}
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-start gap-3 rounded-xl bg-muted/40 p-4 text-sm">
            <Link2
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-foreground">
                Apps subscribed to webhooks
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {health.subscribedAppsError
                  ?? (health.subscribedApps && health.subscribedApps.length > 0
                    ? health.subscribedApps.join(", ")
                    : "None — Meta is not delivering this account's webhooks to any app.")}
              </p>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <KeyRound className="size-3.5" aria-hidden="true" />
            Secrets are managed in the deployment&apos;s environment; see the
            WhatsApp runbook to rotate them.
          </p>
        </div>
      )}
    </Section>
  );
}

export function WhatsAppMetaHealthSkeleton() {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-9 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
      </div>
    </div>
  );
}
