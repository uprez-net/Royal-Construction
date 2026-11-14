"use client";

import { ComplianceDocumentType } from "@prisma/client";
import {
  Award,
  BadgeCheck,
  Building2,
  Calculator,
  ChevronsUpDown,
  ClipboardList,
  Coins,
  Construction,
  DraftingCompass,
  Droplets,
  FileBadge,
  FileCheck2,
  FileText,
  Flame,
  Gavel,
  HandCoins,
  Landmark,
  LandPlot,
  Leaf,
  ListChecks,
  Map,
  Mountain,
  Pickaxe,
  Receipt,
  Ruler,
  ScrollText,
  ShieldCheck,
  TrafficCone,
  Trash2,
  UserCheck,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  complianceDocumentLabel,
  IDENTIFIABLE_DOCUMENT_GROUPS,
} from "@/constants/complianceDocuments";

const TYPE_ICONS: Partial<Record<ComplianceDocumentType, LucideIcon>> = {
  [ComplianceDocumentType.INVOICE]: Receipt,
  [ComplianceDocumentType.FEE_PROPOSAL]: HandCoins,
  [ComplianceDocumentType.CDC_FORM]: ClipboardList,
  [ComplianceDocumentType.CHECKLIST]: ListChecks,
  [ComplianceDocumentType.DEPOSITED_PLAN]: Map,
  [ComplianceDocumentType.TITLE_SEARCH_DETAIL_AND_LEVEL]: ScrollText,
  [ComplianceDocumentType.SURVEY]: LandPlot,
  [ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS]: Ruler,
  [ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN]: DraftingCompass,
  [ComplianceDocumentType.PLANNING_CERTIFICATE_10_7]: FileBadge,
  [ComplianceDocumentType.LAND_DEED]: Landmark,
  [ComplianceDocumentType.HOME_INSURANCE]: ShieldCheck,
  [ComplianceDocumentType.BASIX_CERTIFICATE]: Leaf,
  [ComplianceDocumentType.BUSHFIRE_REPORT]: Flame,
  [ComplianceDocumentType.STRUCTURAL_DRAWINGS]: Building2,
  [ComplianceDocumentType.HYDRAULIC_STORMWATER_DRAWINGS]: Droplets,
  [ComplianceDocumentType.GEOTECH_REPORT]: Mountain,
  [ComplianceDocumentType.WATER_SERVICING_APPROVAL]: Waves,
  [ComplianceDocumentType.SECTION_73_NOTICE]: FileCheck2,
  [ComplianceDocumentType.ROAD_OPENING_PERMIT]: Construction,
  [ComplianceDocumentType.LONG_SERVICE_LEVY]: Coins,
  [ComplianceDocumentType.MINE_SUBSIDENCE_APPROVAL]: Pickaxe,
  [ComplianceDocumentType.WASTE_MANAGEMENT_PLAN]: Trash2,
  [ComplianceDocumentType.TRAFFIC_CONTROL_PLAN]: TrafficCone,
  [ComplianceDocumentType.BUILD_COST_SUMMARY]: Calculator,
  [ComplianceDocumentType.OWNER_CONSENT_FORM]: UserCheck,
  [ComplianceDocumentType.DEVELOPMENT_CONSENT]: Gavel,
  [ComplianceDocumentType.CONSTRUCTION_CERTIFICATE]: Award,
  [ComplianceDocumentType.COMPLYING_DEVELOPMENT_CERTIFICATE]: BadgeCheck,
};

function iconFor(type: ComplianceDocumentType): LucideIcon {
  return TYPE_ICONS[type] ?? FileText;
}

/**
 * "What is this?" for an attachment nobody could place: every type it could
 * be, grouped and searchable.
 *
 * A type that already holds a file is tagged, because choosing it replaces
 * that file rather than adding a second — and on a survey or a set of plans
 * that is the authoritative copy, so the admin should see it before choosing.
 */
export function IdentifyDocumentPicker({
  disabled,
  filledTypes,
  onSelect,
}: {
  disabled?: boolean;
  /** Types that already have a file on this engagement. */
  filledTypes: ReadonlySet<ComplianceDocumentType>;
  onSelect: (type: ComplianceDocumentType) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-label="What is this document?"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal text-muted-foreground sm:max-w-xs"
        >
          What is this?
          <ChevronsUpDown aria-hidden="true" className="size-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0 sm:w-96"
        aria-label="Select document type"
      >
        <Command label="Search document types">
          <CommandInput placeholder="Search document types…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No document type matches.</CommandEmpty>
            {IDENTIFIABLE_DOCUMENT_GROUPS.map((group) =>
              group.types.length > 0 ? (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.types.map((type) => {
                    const Icon = iconFor(type);
                    const label = complianceDocumentLabel(type);
                    return (
                      <CommandItem
                        key={type}
                        value={`${label} ${group.heading}`}
                        onSelect={() => {
                          setOpen(false);
                          onSelect(type);
                        }}
                      >
                        <Icon
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {filledTypes.has(type) ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] font-normal text-warning-ink"
                          >
                            Replaces current
                          </Badge>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
