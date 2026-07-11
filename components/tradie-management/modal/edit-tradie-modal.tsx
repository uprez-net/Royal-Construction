"use client";
import { useAppDispatch } from "@/lib/store/hooks";
import { TradieDetails } from "@/types/tradie";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Mail, MapPin, Pencil, Phone, StickyNote } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateTradieThunk } from "@/lib/store/slices/tradieManagementSlice";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/common/searchable-select";
import { AddressSuggestion } from "@/types/data";
import { fetchJson } from "@/utils/fetch";

interface EditTradieModalProps {
  open: boolean;
  tradie: TradieDetails;
  onClose: () => void;
}

interface TradieUpdateInput {
  email?: string;
  phone?: string;
  location?: string;
  note?: string;
}

// Strips spaces, dashes, and parens so "04 1234 5678" / "(02) 1234-5678" normalize cleanly.
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, "");

// AU mobiles: 04XX XXX XXX or +614XX XXX XXX
// AU landlines: 0[2378] XXXX XXXX (area codes 02/03/07/08) or +61 [2378] XXXX XXXX
const AU_PHONE_REGEX = /^(?:\+?61|0)[2-478]\d{8}$/;

const updateTradieSchema = z.object({
  email: z.email("Please enter a valid email address"),
  phone: z
    .string()
    .min(1, "Phone number is required")
    .refine(
      (value) => AU_PHONE_REGEX.test(normalizePhone(value)),
      "Enter a valid Australian number, e.g. 04XX XXX XXX or 02 XXXX XXXX",
    ),
  location: z.string().min(2, "Location is required").optional(),
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
  const [locationSuggestions, setLocationSuggestions] = useState<
    AddressSuggestion[]
  >([]);
  const [formData, setFormData] = useState<TradieUpdateInput>({
    email: tradie.email,
    phone: tradie.phone,
    location: tradie.location ?? "",
    note: tradie.note ?? "",
  });

  const changes = useMemo(() => {
    return Object.fromEntries(
      Object.entries(formData).filter(([key, value]) => {
        const newValue = value?.trim() || null;
        const oldValue = tradie[key as keyof TradieDetails] || null;

        return newValue !== oldValue;
      }),
    ) as TradieUpdateInput;
  }, [formData, tradie]);

  useEffect(() => {
    if (!open || siteAddress.length < 3) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchJson<{ suggestions: AddressSuggestion[] }>(
          `/api/address?query=${encodeURIComponent(siteAddress)}`,
          { method: "GET" },
          "Error fetching location suggestions",
          controller.signal,
        );

        setLocationSuggestions(response.data.suggestions);
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Failed to fetch location suggestions", error);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, siteAddress]);

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

  const fields = [
    {
      key: "email",
      label: "Email Address",
      icon: Mail,
      placeholder: "john@smith-electrical.com",
    },
    {
      key: "phone",
      label: "Phone Number",
      icon: Phone,
      placeholder: "0412 345 678",
    },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className="rounded-lg bg-primary/10 p-2">
              <Pencil className="h-5 w-5 text-primary" />
            </div>
            Edit Tradie Details
          </DialogTitle>

          <DialogDescription>
            Update contact information and internal notes for this tradie.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <div className="grid gap-5 md:grid-cols-2">
            {fields.map(({ key, label, icon: Icon, placeholder }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{label}</Label>

                <div className="relative">
                  <Icon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />

                  <Input
                    id={key}
                    className="pl-9"
                    placeholder={placeholder}
                    value={formData[key]}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                  />
                </div>

                {errors[key] && (
                  <p className="text-xs text-destructive">{errors[key]}</p>
                )}
              </div>
            ))}

            <div key="location" className="space-y-2">
              <Label className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Tradie Location
              </Label>
              <SearchableSelect
                label=""
                placeholder="Select address..."
                searchValue={siteAddress}
                selectedItem={selectedLocation}
                items={locationSuggestions}
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
              <Label className="flex items-center gap-2">
                <StickyNote className="h-4 w-4" />
                Internal Notes
              </Label>

              <Textarea
                rows={4}
                maxLength={500}
                placeholder="Add notes about reliability, preferences, availability..."
                value={formData.note}
                onChange={(e) => handleInputChange("note", e.target.value)}
              />

              <p className="text-right text-xs text-muted-foreground">
                {formData.note?.length ?? 0}/500
              </p>
              {errors.note && (
                <p className="text-xs text-destructive">{errors.note}</p>
              )}
            </div>
          </div>

          <div className="flex justify-between border-t pt-4">
            <p className="text-sm text-muted-foreground">
              {hasChanges ? "You have unsaved changes" : "No changes made"}
            </p>

            <div className="flex gap-2">
              <Button variant="outline" disabled={isPending} onClick={onClose}>
                Cancel
              </Button>

              <Button
                disabled={!hasChanges || isPending}
                onClick={() => startTransition(handleSubmit)}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Pencil className="mr-2 h-4 w-4" />
                    Save Changes
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
