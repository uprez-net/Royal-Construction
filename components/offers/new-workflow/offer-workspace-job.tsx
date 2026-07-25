"use client";

import { AddressAutocomplete } from "@/components/common/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OfferPrefillResult } from "@/lib/data/offer-prefill";
import {
  createIndividualOwner,
  createOfferSignatory,
  deriveOwnerProjection,
  DIRECTOR_SIGNER_CAPACITY,
  FACADE_OPTIONS,
  OWNER_SIGNER_CAPACITY,
  type OfferOwner,
  type OfferOwnerKind,
  type OfferOwnerSignatory,
  type OfferWorkspaceJob,
} from "@/lib/offer/workspace-model";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { ClipboardList, Info, Plus, Sparkles, Trash2 } from "lucide-react";
import type { PropsWithChildren } from "react";
import { OfferCardHeading } from "./offer-workspace-card-heading";
import { numberInputValue } from "./offer-workspace-format";

type JobSetupPanelProps = {
  readonly job: OfferWorkspaceJob;
  readonly onJobChange: (patch: Partial<OfferWorkspaceJob>) => void;
  readonly onPrefillFromLead?: () => void;
  readonly canPrefill?: boolean;
  readonly prefilling?: boolean;
  readonly prefillResult?: OfferPrefillResult | null;
};

export function JobSetupPanel({
  job,
  onJobChange,
  onPrefillFromLead,
  canPrefill = false,
  prefilling = false,
  prefillResult = null,
}: JobSetupPanelProps) {
  const totalArea =
    job.groundFloorSqm +
    job.firstFloorSqm +
    job.garageSqm +
    job.alfrescoPorchSqm +
    job.porchSqm +
    job.grannyFlatSqm;

  const owners = job.owners ?? [];
  // owners[] is the source of truth; emit the derived flat client* projection in
  // the same patch so legacy consumers stay in sync (ADR 0003).
  const emitOwners = (next: readonly OfferOwner[]) =>
    onJobChange({ owners: next, ...deriveOwnerProjection(next) });

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <OfferCardHeading
            description="Capture the client, site, validity and build-size facts used across the Offer document and Tender draft."
            icon={<ClipboardList className="size-4" aria-hidden="true" />}
            title="Job setup"
          />
          {canPrefill && onPrefillFromLead ? (
            <Button
              className="shrink-0"
              disabled={prefilling}
              size="sm"
              type="button"
              variant="outline"
              onClick={onPrefillFromLead}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              {prefilling ? "Reading the lead…" : "Pre-fill from lead"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <PrefillBanner result={prefillResult} />
        <OwnersSection owners={owners} onOwnersChange={emitOwners} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Build type">
            <Input
              value={job.buildType}
              onChange={(event) => onJobChange({ buildType: event.target.value })}
            />
          </Field>
          <Field label="Façade">
            <Select
              value={job.facade || "__none__"}
              onValueChange={(value) =>
                onJobChange({ facade: value === "__none__" ? "" : value })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a façade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not selected</SelectItem>
                {FACADE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="md:col-span-2" label="Site Location">
            <AddressAutocomplete
              placeholder="Construction site address"
              value={job.siteAddress}
              onChange={(siteAddress) =>
                // A free-text edit invalidates the council/state/postcode from a
                // previously-picked suggestion — clear them so a hand-corrected
                // address can't ship a stale council to Project.council (codex
                // #6). onPick re-sets them when a suggestion is chosen.
                onJobChange({
                  siteAddress,
                  siteCouncil: "",
                  siteState: "",
                  sitePostcode: "",
                })
              }
              onPick={(pick) =>
                onJobChange({
                  siteAddress: pick.address,
                  siteCouncil: pick.council ?? "",
                  siteState: pick.state ?? "",
                  sitePostcode: pick.postcode ?? "",
                })
              }
            />
          </Field>
          <Field label="Council">
            <Input
              placeholder="Auto-filled from Site Location"
              value={job.siteCouncil}
              onChange={(event) => onJobChange({ siteCouncil: event.target.value })}
            />
          </Field>
          {/* Site particulars. These print on the proposal snapshot and the
              tender's Project Particulars table; without inputs they stayed at
              the model defaults and every document shipped "Lot Area: 0 m²". */}
          <AreaField
            label="Lot area sqm"
            value={job.lotAreaSqm}
            onChange={(lotAreaSqm) => onJobChange({ lotAreaSqm })}
          />
          <Field label="DP / title reference">
            <Input
              placeholder="e.g. Lot 12 DP 1234567"
              value={job.dpNumber}
              onChange={(event) => onJobChange({ dpNumber: event.target.value })}
            />
          </Field>
          <Field label="Zoning">
            <Input
              placeholder="e.g. R2 Low Density Residential"
              value={job.zoning}
              onChange={(event) => onJobChange({ zoning: event.target.value })}
            />
          </Field>
          <Field label="Valid until">
            <Input
              type="date"
              value={job.validUntil}
              onChange={(event) => onJobChange({ validUntil: event.target.value })}
            />
          </Field>
          <Field label="Prepared by">
            <Input
              value={job.preparedBy}
              onChange={(event) => onJobChange({ preparedBy: event.target.value })}
            />
          </Field>
          <Field
            className="md:col-span-2 xl:col-span-4"
            label="Build scope (one feature per line — shown on the proposal snapshot)"
          >
            <Textarea
              className="min-h-[76px]"
              value={job.buildScope.join("\n")}
              placeholder="4 Bedrooms + Study&#10;Double Garage&#10;Alfresco"
              onChange={(event) =>
                onJobChange({ buildScope: event.target.value.split("\n") })
              }
            />
          </Field>
          <AreaField
            label="Ground floor sqm"
            value={job.groundFloorSqm}
            onChange={(groundFloorSqm) => onJobChange({ groundFloorSqm })}
          />
          <AreaField
            label="First floor sqm"
            value={job.firstFloorSqm}
            onChange={(firstFloorSqm) => onJobChange({ firstFloorSqm })}
          />
          <AreaField
            label="Garage sqm"
            value={job.garageSqm}
            onChange={(garageSqm) => onJobChange({ garageSqm })}
          />
          <AreaField
            label="Alfresco sqm"
            value={job.alfrescoPorchSqm}
            onChange={(alfrescoPorchSqm) => onJobChange({ alfrescoPorchSqm })}
          />
          <AreaField
            label="Porch sqm"
            value={job.porchSqm}
            onChange={(porchSqm) => onJobChange({ porchSqm })}
          />
          <AreaField
            label="Granny flat sqm"
            value={job.grannyFlatSqm}
            onChange={(grannyFlatSqm) => onJobChange({ grannyFlatSqm })}
          />
          <div className="rounded-lg border border-royal-gold/30 bg-royal-gold-light/70 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total building area
            </p>
            <p className="font-mono text-lg font-semibold">{totalArea} sqm</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Owner parties editor (ADR 0003 / issues #103, #111). owners[] is the source of
// truth; the parent syncs the derived flat client* projection. Each owner is an
// individual (one signatory) or a company (name + ABN/ACN + registered office +
// one or more director signatories). For an individual the display name mirrors
// their single signatory's name so the signature blocks + DocuSign recipient use
// it.
// Module-scope id generator (kept out of the render body so it does not trip the
// react purity rule) — used only in event handlers to key new owners/directors.
function newOwnerId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function OwnersSection({
  owners,
  onOwnersChange,
}: {
  readonly owners: readonly OfferOwner[];
  readonly onOwnersChange: (next: readonly OfferOwner[]) => void;
}) {
  const updateOwner = (index: number, patch: Partial<OfferOwner>) =>
    onOwnersChange(
      owners.map((owner, i) => (i === index ? { ...owner, ...patch } : owner)),
    );

  const setKind = (index: number, kind: OfferOwnerKind) =>
    onOwnersChange(
      owners.map((owner, i) => {
        if (i !== index || owner.kind === kind) return owner;
        if (kind === "company") {
          // Existing signatories become directors.
          const directors =
            owner.signatories.length > 0
              ? owner.signatories
              : [createOfferSignatory(newOwnerId(`${owner.id}-dir`), DIRECTOR_SIGNER_CAPACITY)];
          return {
            ...owner,
            kind,
            signatories: directors.map((signatory) => ({
              ...signatory,
              capacity: DIRECTOR_SIGNER_CAPACITY,
            })),
          };
        }
        // Individual: collapse to one signatory (the person themselves).
        const first =
          owner.signatories[0] ??
          createOfferSignatory(newOwnerId(`${owner.id}-signer`), OWNER_SIGNER_CAPACITY);
        return {
          ...owner,
          kind,
          signatories: [
            {
              ...first,
              name: owner.displayName || first.name,
              capacity: OWNER_SIGNER_CAPACITY,
            },
          ],
        };
      }),
    );

  const setIndividualName = (index: number, value: string) =>
    onOwnersChange(
      owners.map((owner, i) =>
        i === index
          ? {
              ...owner,
              displayName: value,
              signatories: owner.signatories.map((signatory, si) =>
                si === 0 ? { ...signatory, name: value } : signatory,
              ),
            }
          : owner,
      ),
    );

  const updateSignatory = (
    ownerIndex: number,
    sigIndex: number,
    patch: Partial<OfferOwnerSignatory>,
  ) =>
    onOwnersChange(
      owners.map((owner, i) =>
        i === ownerIndex
          ? {
              ...owner,
              signatories: owner.signatories.map((signatory, si) =>
                si === sigIndex ? { ...signatory, ...patch } : signatory,
              ),
            }
          : owner,
      ),
    );

  const addDirector = (index: number) =>
    onOwnersChange(
      owners.map((owner, i) =>
        i === index
          ? {
              ...owner,
              signatories: [
                ...owner.signatories,
                createOfferSignatory(newOwnerId(`${owner.id}-dir`), DIRECTOR_SIGNER_CAPACITY),
              ],
            }
          : owner,
      ),
    );

  const removeDirector = (ownerIndex: number, sigIndex: number) =>
    onOwnersChange(
      owners.map((owner, i) =>
        i === ownerIndex
          ? {
              ...owner,
              signatories: owner.signatories.filter((_, si) => si !== sigIndex),
            }
          : owner,
      ),
    );

  const addOwner = () =>
    onOwnersChange([...owners, createIndividualOwner(newOwnerId("owner"))]);

  const removeOwner = (index: number) =>
    onOwnersChange(owners.filter((_, i) => i !== index));

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Owners
        </span>
        <Button size="sm" type="button" variant="outline" onClick={addOwner}>
          <Plus className="size-4" aria-hidden="true" /> Add owner
        </Button>
      </div>
      {owners.map((owner, index) => (
        <div
          key={owner.id}
          className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-border/70 p-0.5">
              {(["individual", "company"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKind(index, kind)}
                  className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${
                    owner.kind === kind
                      ? "bg-royal-gold text-white"
                      : "text-muted-foreground"
                  }`}
                >
                  {kind}
                </button>
              ))}
            </div>
            {owners.length > 1 ? (
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => removeOwner(index)}
                aria-label={`Remove owner ${index + 1}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          {owner.kind === "individual" ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Owner name">
                <Input
                  value={owner.displayName}
                  onChange={(event) => setIndividualName(index, event.target.value)}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={owner.signatories[0]?.email ?? ""}
                  onChange={(event) =>
                    updateSignatory(index, 0, { email: event.target.value })
                  }
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={owner.signatories[0]?.phone ?? ""}
                  onChange={(event) =>
                    updateSignatory(index, 0, { phone: event.target.value })
                  }
                />
              </Field>
              <Field label="Current Location">
                <AddressAutocomplete
                  placeholder="Where the owner currently lives"
                  value={owner.currentLocation}
                  onChange={(currentLocation) =>
                    updateOwner(index, { currentLocation })
                  }
                />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Company name">
                  <Input
                    value={owner.displayName}
                    onChange={(event) =>
                      updateOwner(index, { displayName: event.target.value })
                    }
                  />
                </Field>
                <Field label="ABN / ACN">
                  <Input
                    value={owner.abn}
                    onChange={(event) => updateOwner(index, { abn: event.target.value })}
                  />
                </Field>
                <Field
                  className="md:col-span-2"
                  label="Registered office (Current Location)"
                >
                  <AddressAutocomplete
                    placeholder="Company registered office"
                    value={owner.currentLocation}
                    onChange={(currentLocation) =>
                      updateOwner(index, { currentLocation })
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-2 rounded-md border border-border/60 bg-background/60 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Director signatories
                  </span>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => addDirector(index)}
                  >
                    <Plus className="size-3.5" aria-hidden="true" /> Add director
                  </Button>
                </div>
                {owner.signatories.map((director, sigIndex) => (
                  <div
                    key={director.id}
                    className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <Input
                      placeholder="Director name"
                      value={director.name}
                      onChange={(event) =>
                        updateSignatory(index, sigIndex, { name: event.target.value })
                      }
                    />
                    <Input
                      type="email"
                      placeholder="Director email"
                      value={director.email}
                      onChange={(event) =>
                        updateSignatory(index, sigIndex, { email: event.target.value })
                      }
                    />
                    <Input
                      placeholder="Director phone"
                      value={director.phone}
                      onChange={(event) =>
                        updateSignatory(index, sigIndex, { phone: event.target.value })
                      }
                    />
                    {owner.signatories.length > 1 ? (
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => removeDirector(index, sigIndex)}
                        aria-label={`Remove director ${sigIndex + 1}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PrefillBanner({ result }: { readonly result: OfferPrefillResult | null }) {
  if (!result) {
    return null;
  }
  if (!result.ok) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
        Pre-fill failed: {result.error}
      </p>
    );
  }
  return (
    <div className="grid gap-1.5 rounded-lg border border-royal-gold/30 bg-royal-gold-light/40 p-3 text-xs">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <Sparkles className="size-3.5 text-royal-gold-dark" aria-hidden="true" />
        Drafted from {result.sources.join(", ")}
        {result.confidence ? ` · ${result.confidence} confidence` : ""} — review
        the fields before sending.
      </p>
      {result.notes ? (
        <p className="flex items-start gap-2 text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {result.notes}
        </p>
      ) : null}
    </div>
  );
}

function Field({
  children,
  className,
  label,
}: PropsWithChildren<{ readonly className?: string; readonly label: string }>) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function AreaField({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly value: number;
}) {
  return (
    <Field label={label}>
      <Input
        min="0"
        placeholder="0"
        type="number"
        value={numberInputValue(value)}
        onChange={(event) => {
          const parsedValue = parseNonNegativeNumberInput(event.target.value);
          if (parsedValue !== null) {
            onChange(parsedValue);
          }
        }}
      />
    </Field>
  );
}
