"use client";

import { useMemo, useState } from "react";
import type { ProjectDetail } from "@/types/project";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/utils/fetch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type RequirementsData = Partial<ProjectRequirementsPayload>;

const NUMERIC_FIELDS = new Set([
  "totalContractSum",
  "tenderTotalPrice",
  "contractPrice",
  "gstAmount",
  "depositValue",
  "claimStageSlabPercentage",
  "claimStageSlabDollarValue",
  "variationAdminFee",
  "latePenaltyRate",
  "concreteStrengthMpa",
  "brickAllowance",
  "brickCount",
  "selectedBrickPrice",
  "floorAreaM2",
  "acRequiredCapacityKw",
  "acInstalledCapacityKw",
  "lightingCount",
  "tenderLightingCount",
  "powerPointCount",
  "tileAllowance",
  "selectedTilePrice",
  "wetAreaSizeM2",
  "tiledNicheCount",
  "showerCount",
]);

const BOOLEAN_FIELDS = new Set(["gstIncluded"]);
const STRING_LIST_FIELDS = new Set(["ownerResponsibility", "variationRequired"]);

function formatValue(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.every((entry) => typeof entry === "string")) return value.join(", ");
    return JSON.stringify(value, null, 2);
  }
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function coerceFieldValue(field: string, rawValue: string) {
  if (STRING_LIST_FIELDS.has(field)) {
    return rawValue
      .split(/\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (BOOLEAN_FIELDS.has(field)) {
    if (rawValue === "") {
      return null;
    }

    return rawValue === "true";
  }

  if (NUMERIC_FIELDS.has(field)) {
    if (rawValue.trim() === "") {
      return null;
    }

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return rawValue;
}

function SectionFields({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="rounded-xl border border-border/70 bg-slate-50/70 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</p>
          <p className="mt-1 text-sm font-medium text-foreground">{formatValue(value)}</p>
        </div>
      ))}
    </div>
  );
}

export function ProjectOverviewTab({ project }: { project: ProjectDetail }) {
  const initialRequirements = (project.requirements ?? {}) as RequirementsData;
  const [draft, setDraft] = useState<RequirementsData>(initialRequirements);
  const [saving, setSaving] = useState(false);

  const sections = useMemo(
    () => [
      ["legalAdministration", "Legal and Administration"],
      ["commercialsAndClaims", "Commercials and Claims"],
      ["subStructureAndGround", "Sub Structure and Ground"],
      ["shellAndExternal", "Shell and External"],
      ["mechanicalDetails", "Mechanical Details"],
      ["internalFitOutAndFinishes", "Internal Fit Out and Finishes"],
      ["exclusionsAndRisks", "Exclusions and Risks"],
      ["utilityInfrastructure", "Utility Infrastructure"],
      ["wetAreaCompliance", "Wet Area Compliance"],
      ["safetyAndSiteLogistics", "Safety and Site Logistics"],
    ] as const,
    [],
  );

  const updateField = (section: keyof RequirementsData, field: string, value: unknown) => {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...((current[section] as Record<string, unknown>) ?? {}),
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetchJson<ProjectDetail>(
        `/api/projects/${project.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requirements: draft }),
        },
        "Unable to update project",
      );
      toast.success("Project sections updated");
      setDraft((response.data.requirements ?? draft) as RequirementsData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <Card className="border-border/80 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div>
            <CardTitle className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
              Project Information
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Ten collapsible sections derived from the extraction payload.
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="rounded-lg bg-teal-600 text-white hover:bg-teal-700">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardHeader>
        <CardContent className="pt-5">
          <Accordion type="multiple" className="space-y-2">
            {sections.map(([key, label]) => {
              const sectionData = (draft[key] as unknown as Record<string, unknown>) ?? {};
              const sectionValidations = (draft.validations ?? []).filter((entry) => entry.section === key);

              return (
                <AccordionItem key={key} value={key} className="rounded-xl border border-border/70 bg-slate-50/50 px-4">
                  <AccordionTrigger className="py-4 hover:no-underline">
                    <div className="flex flex-1 items-center justify-between gap-3 pr-3 text-left">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{label}</p>
                        <p className="text-xs text-muted-foreground">{Object.keys(sectionData).length} fields</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {sectionValidations.some((entry) => entry.severity === "fail") ? <Badge className="bg-[#E8730C] text-white hover:bg-[#E8730C]">Validation issue</Badge> : null}
                        {sectionValidations.some((entry) => entry.ownerResponsibility) ? <Badge variant="outline">Owner responsibility</Badge> : null}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-2">
                      <SectionFields data={sectionData} />
                      <div className="grid gap-3 md:grid-cols-2">
                        {Object.entries(sectionData).map(([field, value]) => (
                          <div key={field} className="space-y-1">
                            <label className="text-xs font-semibold text-muted-foreground">{field.replace(/([A-Z])/g, " $1")}</label>
                            {BOOLEAN_FIELDS.has(field) ? (
                              <select
                                value={typeof value === "boolean" ? String(value) : ""}
                                onChange={(event) => updateField(key, field, coerceFieldValue(field, event.target.value))}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                              >
                                <option value="">Unknown</option>
                                <option value="true">Yes</option>
                                <option value="false">No</option>
                              </select>
                            ) : STRING_LIST_FIELDS.has(field) ? (
                              <Textarea
                                value={Array.isArray(value) ? value.join("\n") : ""}
                                onChange={(event) => updateField(key, field, coerceFieldValue(field, event.target.value))}
                                className="min-h-24"
                              />
                            ) : (Array.isArray(value) && !value.every((entry) => typeof entry === "string")) ||
                              (value !== null && typeof value === "object") ? (
                              <Textarea value={formatValue(value)} readOnly className="min-h-24 font-mono text-xs" />
                            ) : typeof value === "string" && value.length > 80 ? (
                              <Textarea value={value} onChange={(event) => updateField(key, field, event.target.value)} className="min-h-24" />
                            ) : (
                              <Input
                                type={NUMERIC_FIELDS.has(field) ? "number" : "text"}
                                value={value === null || value === undefined ? "" : String(value)}
                                onChange={(event) => updateField(key, field, coerceFieldValue(field, event.target.value))}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      {sectionValidations.length > 0 ? (
                        <div className="space-y-2 rounded-xl border border-[#E8730C]/20 bg-[#E8730C]/5 p-3">
                          {sectionValidations.map((validation) => (
                            <div key={validation.id} className={cn("text-sm", validation.severity === "fail" ? "text-[#E8730C]" : "text-amber-700")}>
                              {validation.message}
                              {validation.ownerResponsibility ? " Owner Responsibility." : null}
                              {validation.variationRequired ? " Variation required." : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    </section>
  );
}
