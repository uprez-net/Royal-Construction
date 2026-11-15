"use client";
import { useAppDispatch } from "@/lib/store/hooks";
import { TradieDetails } from "@/types/tradie";
import { useMemo, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Briefcase,
  Loader2,
  Mail,
  Mails,
  MapPin,
  Pencil,
  Phone,
  StickyNote,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateTradieThunk } from "@/lib/store/slices/tradieManagementSlice";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/common/searchable-select";
import { useAddressSuggestions } from "@/hooks/use-address-suggestions";
import { AddressSuggestion } from "@/types/data";
import { cn } from "@/lib/utils";
import { EmailListInput } from "./forms/EmailLIstInput";
import { TradeTypesField } from "./forms/TradieTypeInput";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { tradieTrades } from "@/lib/domain/tradies/request-rules";

interface EditTradieModalProps {
  open: boolean;
  tradie: TradieDetails;
  onClose: () => void;
}

interface TradieUpdateInput {
  name?: string;
  abn?: string;
  email?: string;
  phone?: string;
  location?: string;
  note?: string;
  additionalEmails?: string[];
  /** Every category, the primary first. */
  trades?: string[];
}

// Strips spaces, dashes, and parens so "04 1234 5678" / "(02) 1234-5678" normalize cleanly.
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, "");

// AU mobiles: 04XX XXX XXX or +614XX XXX XXX
// AU landlines: 0[2378] XXXX XXXX (area codes 02/03/07/08) or +61 [2378] XXXX XXXX
const AU_PHONE_REGEX = /^(?:\+?61|0)[2-478]\d{8}$/;

const updateTradieSchema = z.object({
  name: z.string().trim().min(2, "Enter a name with at least 2 characters"),
  email: z.email("Please enter a valid email address"),
  additionalEmails: z
    .array(z.email("Please enter a valid email address"))
    .optional(),
  phone: z
    .string()
    .min(1, "Phone number is required")
    .refine(
      (value) => AU_PHONE_REGEX.test(normalizePhone(value)),
      "Enter a valid Australian number, e.g. 04XX XXX XXX or 02 XXXX XXXX",
    ),
  location: z.string().min(2, "Location is required").optional(),
  trades: z
    .array(z.string().min(1))
    .min(1, "Select at least one trade type")
    .optional(),
  note: z.string().max(500, "Notes cannot exceed 500 characters").optional(),
});

export default function EditTradieModal({
  open,
  tradie,
  onClose,
}: EditTradieModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<
    Partial<Record<keyof TradieUpdateInput, string>>
  >({});
  const [siteAddress, setSiteAddress] = useState<string>(tradie.location ?? "");
  const [selectedLocation, setSelectedLocation] =
    useState<AddressSuggestion | null>(null);
  const address = useAddressSuggestions(siteAddress, open);
  const [formData, setFormData] = useState<TradieUpdateInput>({
    name: tradie.name,
    abn: tradie.abn,
    email: tradie.email,
    phone: tradie.phone,
    location: tradie.location ?? "",
    note: tradie.note ?? "",
    additionalEmails: tradie.additionalEmails ?? [],
    trades: tradieTrades(tradie),
  });

  const changes = useMemo(() => {
    const original: Record<string, unknown> = {
      ...tradie,
      trades: tradieTrades(tradie),
    };
    return Object.fromEntries(
      Object.entries(formData).filter(([key, value]) => {
        // Lists compare by contents and order: the order of `trades` says
        // which one is primary.
        if (Array.isArray(value)) {
          const before = original[key];
          return (
            !Array.isArray(before)
            || before.length !== value.length
            || before.some((item, index) => item !== value[index])
          );
        }
        const newValue =
          typeof value === "string" ? value?.trim() || null : value;
        const oldValue = original[key] || null;

        return newValue !== oldValue;
      }),
    ) as TradieUpdateInput;
  }, [formData, tradie]);

  const hasChanges = Object.keys(changes).length > 0;

  const handleInputChange = <K extends keyof TradieUpdateInput>(
    field: K,
    value: TradieUpdateInput[K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const handleSubmit = async () => {
    const validation = updateTradieSchema.safeParse(formData);
    if (!validation.success) {
      const fieldErrors: Partial<Record<keyof TradieUpdateInput, string>> = {};

      validation.error.issues.forEach((issue) => {
        fieldErrors[issue.path[0] as keyof TradieUpdateInput] = issue.message;
      });

      setErrors(fieldErrors);
      toast.error("Please fix the highlighted fields");
      return;
    }

    if (!hasChanges) return;

    try {
      await dispatch(
        updateTradieThunk({
          tradieId: tradie.id,
          data: changes,
        }),
      ).unwrap();

      toast.success("Tradie details updated", {
        description: "The latest information has been saved.",
      });

      onClose();
    } catch (error) {
      console.error(error);

      toast.error("Unable to update tradie", {
        description: "Please try again later.",
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const updateField = <K extends keyof TradieUpdateInput>(
    key: K,
    value: TradieUpdateInput[K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const fields = [
    {
      key: "abn",
      label: "ABN",
      icon: Briefcase,
      placeholder: "12 345 678 901",
      mono: true,
    },
    {
      key: "email",
      label: "Email address",
      icon: Mail,
      placeholder: "john@smith-electrical.com",
      mono: false,
    },
    {
      key: "additionalEmails",
      label: "Additional email addresses",
      icon: Mails,
      placeholder: "Add additional emails",
      mono: false,
    },
    {
      key: "phone",
      label: "Phone number",
      icon: Phone,
      placeholder: "0412 345 678",
      mono: true,
    },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className="rounded-lg bg-primary/10 p-2">
              <Pencil className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            Edit tradie details
          </DialogTitle>

          <DialogDescription>
            Update the name, trades, contact information and internal notes for{" "}
            {tradie.name}. Fields marked with an asterisk are required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <div className="grid gap-5 md:grid-cols-2">
            <Field
              className="md:col-span-2"
              data-invalid={Boolean(errors.name)}
            >
              <FieldLabel htmlFor="tradie-edit-name">
                Name <span aria-hidden="true">*</span>
              </FieldLabel>
              <Input
                id="tradie-edit-name"
                name="name"
                required
                disabled={isPending}
                placeholder="Tradie or business name"
                value={formData.name ?? ""}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? "tradie-edit-name-error" : undefined
                }
                onChange={(event) =>
                  handleInputChange("name", event.target.value)
                }
              />
              {errors.name ? (
                <FieldError id="tradie-edit-name-error">
                  {errors.name}
                </FieldError>
              ) : null}
            </Field>
            <div className="md:col-span-2">
              <TradeTypesField
                id="tradie-edit-trades"
                value={formData.trades ?? []}
                disabled={isPending}
                onChange={(trades) => handleInputChange("trades", trades)}
                error={errors.trades}
                requiredMark={
                  <span className="text-destructive">
                    *<span className="sr-only"> required</span>
                  </span>
                }
              />
            </div>
            {fields.map(({ key, label, icon: Icon, placeholder, mono }) => {
              if (key === "additionalEmails") {
                return (
                  <div className="md:col-span-2" key={key}>
                    <EmailListInput
                      value={formData.additionalEmails ?? []}
                      onChange={(emails) =>
                        updateField("additionalEmails", emails)
                      }
                      error={errors.additionalEmails}
                    />
                  </div>
                );
              }
              return (
                // Add and edit modals can be mounted in the same document, so the
                // DOM ids are namespaced per modal; bare "email"/"phone" ids would
                // collide and point a <label for> at the wrong control.
                <div key={key} className="space-y-2">
                  <Label htmlFor={`tradie-edit-${key}`}>
                    {label}
                    <span className="text-destructive">
                      *<span className="sr-only"> required</span>
                    </span>
                  </Label>

                  <div className="relative">
                    <Icon
                      className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />

                    <Input
                      id={`tradie-edit-${key}`}
                      required
                      className={cn("pl-9", mono && "font-mono tabular-nums")}
                      placeholder={placeholder}
                      value={formData[key]}
                      aria-invalid={Boolean(errors[key])}
                      aria-describedby={
                        errors[key] ? `tradie-edit-${key}-error` : undefined
                      }
                      onChange={(e) => updateField(key, e.target.value)}
                    />
                  </div>

                  {errors[key] && (
                    <p
                      id={`tradie-edit-${key}-error`}
                      className="text-xs text-destructive"
                    >
                      {errors[key]}
                    </p>
                  )}
                </div>
              );
            })}

            <div key="location" className="space-y-2">
              {/* The trigger is a Popover button with its own internal search
                  field, so this visible text is a plain div rather than a
                  <label>. It is wired to the trigger by id via `labelledById`;
                  without it the trigger's accessible name fell back to the
                  placeholder, naming the control after its hint. */}
              <div
                id="edit-tradie-location-label"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Tradie location
              </div>
              <SearchableSelect
                labelledById="edit-tradie-location-label"
                label=""
                placeholder="Select address..."
                searchValue={siteAddress}
                selectedItem={selectedLocation}
                items={address.suggestions}
                loading={address.loading}
                error={address.error}
                onRetry={address.retry}
                onQueryChange={(query) => setSiteAddress(query)}
                onSelect={(item) => {
                  const suggestion = item as AddressSuggestion;
                  setSelectedLocation(suggestion);
                  handleInputChange("location", suggestion.address);
                }}
              />
              {errors.location && (
                <p className="text-xs text-destructive">{errors.location}</p>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label
                htmlFor="tradie-edit-note"
                className="flex items-center gap-2"
              >
                <StickyNote className="h-4 w-4" aria-hidden="true" />
                Internal notes
              </Label>

              <Textarea
                id="tradie-edit-note"
                rows={4}
                maxLength={500}
                placeholder="Add notes about reliability, preferences, availability..."
                value={formData.note}
                aria-invalid={Boolean(errors.note)}
                aria-describedby={
                  errors.note
                    ? "tradie-edit-note-error"
                    : "tradie-edit-note-count"
                }
                onChange={(e) => handleInputChange("note", e.target.value)}
              />

              <p
                id="tradie-edit-note-count"
                className="text-right text-xs text-muted-foreground"
              >
                {formData.note?.length ?? 0}/500 characters
              </p>
              {errors.note && (
                <p
                  id="tradie-edit-note-error"
                  className="text-xs text-destructive"
                >
                  {errors.note}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {hasChanges ? "You have unsaved changes" : "No changes made"}
            </p>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="outline" disabled={isPending} onClick={onClose}>
                Cancel
              </Button>

              <Button
                disabled={!hasChanges || isPending}
                onClick={() => startTransition(handleSubmit)}
              >
                {isPending ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Updating…
                  </>
                ) : (
                  <>
                    <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                    Save changes
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
