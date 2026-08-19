import {
  BriefcaseBusiness,
  Building2,
  DollarSign,
  Loader2,
  Mail,
  MapPin,
  Phone,
  PlusCircle,
  StickyNote,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAppDispatch } from "@/lib/store/hooks";
import { addTradie } from "@/lib/store/slices/tradieManagementSlice";
import { CreateTradieInput } from "@/types/tradie";
import { AddressSuggestion } from "@/types/data";
import { SearchableSelect } from "@/components/common/searchable-select";
import { fetchJson } from "@/utils/fetch";
import { cn } from "@/lib/utils";
import { EmailListInput } from "./forms/EmailLIstInput";
import { TradeTypeField } from "./forms/TradieTypeInput";

interface AddTradieModalProps {
  open: boolean;
  onClose: () => void;
}

const initialState: CreateTradieInput = {
  name: "",
  trade: "",
  lastQuotedPrice: 0,
  abn: "",
  phone: "",
  email: "",
  location: "",
  note: "",
  additionalEmails: [],
};

// Strips spaces, dashes, and parens so "04 1234 5678" / "(02) 1234-5678" normalize cleanly.
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, "");

// AU mobiles: 04XX XXX XXX or +614XX XXX XXX
// AU landlines: 0[2378] XXXX XXXX (area codes 02/03/07/08) or +61 [2378] XXXX XXXX
const AU_PHONE_REGEX = /^(?:\+?61|0)[2-478]\d{8}$/;

const normalizeAbn = (value: string) => value.replace(/\s/g, "");

const tradieSchema = z.object({
  name: z.string().min(2, "Enter a name with at least 2 characters"),
  trade: z.string().min(1, "Select a trade type"),
  phone: z
    .string()
    .min(1, "Phone number is required")
    .refine(
      (value) => AU_PHONE_REGEX.test(normalizePhone(value)),
      "Enter a valid Australian number, e.g. 04XX XXX XXX or 02 XXXX XXXX",
    ),
  location: z.string().min(2, "Location is required"),
  lastQuotedPrice: z.number().positive("Last quoted price must be greater than 0"),
  abn: z
    .string()
    .refine(
      (value) => /^\d{11}$/.test(normalizeAbn(value)),
      "ABN must be exactly 11 digits",
    ),
  email: z.email("Enter a valid email address"),
  additionalEmails: z.array(z.email("Enter a valid email address")).optional(),
  note: z.string().max(500).optional(),
});

type TradieField = keyof CreateTradieInput;

/** Visible required indicator that also announces itself. */
function RequiredMark() {
  return (
    <span className="text-destructive">
      *<span className="sr-only"> required</span>
    </span>
  );
}

export default function AddTradieModal({ open, onClose }: AddTradieModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const [formData, setFormData] = useState<CreateTradieInput>(initialState);
  const [touched, setTouched] = useState<Partial<Record<TradieField, boolean>>>(
    {},
  );
  const [siteAddress, setSiteAddress] = useState("");
  const [selectedLocation, setSelectedLocation] =
    useState<AddressSuggestion | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<
    AddressSuggestion[]
  >([]);

  const validation = useMemo(
    () => tradieSchema.safeParse(formData),
    [formData],
  );
  const isValid = validation.success;

  const errors = useMemo(() => {
    const fieldErrors: Partial<Record<TradieField, string>> = {};
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const key = issue.path[0] as TradieField;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
    }
    return fieldErrors;
  }, [validation]);

  useEffect(() => {
    if (!open || siteAddress.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchJson<{ suggestions: AddressSuggestion[] }>(
          `/api/address?query=${siteAddress}`,
          {
            method: "GET",
          },
          "Unable to fetch addresses",
          controller.signal,
        );
        setLocationSuggestions(response.data.suggestions);
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error(error);
        }
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [siteAddress, open]);

  const updateField = <K extends keyof CreateTradieInput>(
    key: K,
    value: CreateTradieInput[K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const markTouched = (key: TradieField) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const fieldError = (key: TradieField) =>
    touched[key] ? errors[key] : undefined;

  const handleSubmit = async () => {
    if (!isValid) {
      setTouched({
        name: true,
        trade: true,
        phone: true,
        location: true,
        lastQuotedPrice: true,
        abn: true,
        email: true,
        note: true,
      });
      toast.error("Please fix the highlighted fields");
      return;
    }
    try {
      await dispatch(addTradie(formData)).unwrap();
      toast.success("Tradie created", {
        description: `${formData.name} has been added successfully.`,
      });
      handleOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Unable to add tradie");
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setFormData(initialState);
      setSelectedLocation(null);
      setSiteAddress("");
      setTouched({});
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="rounded-lg bg-primary/10 p-2">
              <PlusCircle className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            Add new tradie
          </DialogTitle>
          <DialogDescription>
            Register a contractor profile with contact, trade and pricing
            information. Fields marked with an asterisk are required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Business information
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label
                  htmlFor="tradie-name"
                  className="flex items-center gap-2"
                >
                  <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />
                  Business / tradie name
                  <RequiredMark />
                </Label>
                <Input
                  id="tradie-name"
                  required
                  value={formData.name}
                  aria-invalid={Boolean(fieldError("name"))}
                  aria-describedby={
                    fieldError("name") ? "tradie-name-error" : undefined
                  }
                  onChange={(e) => updateField("name", e.target.value)}
                  onBlur={() => markTouched("name")}
                  className={cn(
                    fieldError("name") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {fieldError("name") && (
                  <p
                    id="tradie-name-error"
                    className="text-xs text-destructive"
                  >
                    {fieldError("name")}
                  </p>
                )}
              </div>
              <TradeTypeField
                id="tradie-trade"
                value={formData.trade}
                onChange={(value) => updateField("trade", value)}
                onBlur={() => markTouched("trade")}
                error={fieldError("trade")}
                requiredMark={<RequiredMark />}
              />
              <div className="space-y-2">
                <Label htmlFor="tradie-abn" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                  ABN
                  <RequiredMark />
                </Label>
                <Input
                  id="tradie-abn"
                  required
                  inputMode="numeric"
                  maxLength={14} // allows for "XX XXX XXX XXX" spacing while typing
                  value={formData.abn}
                  aria-invalid={Boolean(fieldError("abn"))}
                  aria-describedby="tradie-abn-hint"
                  className={cn(
                    "font-mono tabular-nums",
                    fieldError("abn") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                  onChange={(e) => {
                    // Only allow digits and spaces as the user types
                    const raw = e.target.value.replace(/[^\d\s]/g, "");
                    updateField("abn", raw);
                  }}
                  onBlur={() => markTouched("abn")}
                />
                {fieldError("abn") ? (
                  <p id="tradie-abn-hint" className="text-xs text-destructive">
                    {fieldError("abn")}
                  </p>
                ) : (
                  <p
                    id="tradie-abn-hint"
                    className="text-xs text-muted-foreground"
                  >
                    Format: XX XXX XXX XXX
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="tradie-rate"
                  className="flex items-center gap-2"
                >
                  <DollarSign className="h-4 w-4" aria-hidden="true" />
                  Last Quoted Price
                  <RequiredMark />
                </Label>
                <div className="relative">
                  <DollarSign
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="tradie-rate"
                    required
                    className={cn(
                      "pl-8 font-mono tabular-nums",
                      fieldError("lastQuotedPrice") &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                    type="number"
                    min={0}
                    step="0.01"
                    value={formData.lastQuotedPrice || ""}
                    aria-invalid={Boolean(fieldError("lastQuotedPrice"))}
                    aria-describedby={
                      fieldError("lastQuotedPrice") ? "tradie-rate-error" : undefined
                    }
                    onChange={(e) =>
                      updateField(
                        "lastQuotedPrice",
                        e.target.value === "" ? 0 : Number(e.target.value),
                      )
                    }
                    onBlur={() => markTouched("lastQuotedPrice")}
                  />
                </div>
                {fieldError("lastQuotedPrice") && (
                  <p
                    id="tradie-rate-error"
                    className="text-xs text-destructive"
                  >
                    {fieldError("lastQuotedPrice")}
                  </p>
                )}
              </div>
            </div>
          </section>
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Phone className="h-4 w-4" aria-hidden="true" />
              Contact details
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label
                  htmlFor="tradie-phone"
                  className="flex items-center gap-2"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Phone number
                  <RequiredMark />
                </Label>
                <Input
                  id="tradie-phone"
                  required
                  inputMode="tel"
                  value={formData.phone}
                  aria-invalid={Boolean(fieldError("phone"))}
                  aria-describedby="tradie-phone-hint"
                  onChange={(e) => updateField("phone", e.target.value)}
                  onBlur={() => markTouched("phone")}
                  className={cn(
                    "font-mono tabular-nums",
                    fieldError("phone") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {fieldError("phone") ? (
                  <p
                    id="tradie-phone-hint"
                    className="text-xs text-destructive"
                  >
                    {fieldError("phone")}
                  </p>
                ) : (
                  <p
                    id="tradie-phone-hint"
                    className="text-xs text-muted-foreground"
                  >
                    Mobile: 04XX XXX XXX &middot; Landline: 02/03/07/08 XXXX
                    XXXX
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="tradie-email"
                  className="flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Email address
                  <RequiredMark />
                </Label>
                <Input
                  id="tradie-email"
                  required
                  type="email"
                  value={formData.email}
                  aria-invalid={Boolean(fieldError("email"))}
                  aria-describedby={
                    fieldError("email") ? "tradie-email-error" : undefined
                  }
                  onChange={(e) => updateField("email", e.target.value)}
                  onBlur={() => markTouched("email")}
                  className={cn(
                    fieldError("email") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {fieldError("email") && (
                  <p
                    id="tradie-email-error"
                    className="text-xs text-destructive"
                  >
                    {fieldError("email")}
                  </p>
                )}
              </div>

              <div className="md:col-span-2">
                <EmailListInput
                  value={formData.additionalEmails ?? []}
                  onChange={(emails) => updateField("additionalEmails", emails)}
                  onBlur={() => markTouched("additionalEmails")}
                  error={fieldError("additionalEmails")}
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                {/* The trigger is a Popover button with its own internal search
                    field, so the visible text above is a plain div rather than a
                    <label>. It is wired to the trigger by id via `labelledById`
                    instead — without it the trigger's accessible name fell back
                    to the placeholder ("Search service location..."), which
                    names the control after its hint rather than its field. */}
                <div
                  id="tradie-location-label"
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Tradie location
                  <RequiredMark />
                </div>
                <SearchableSelect
                  labelledById="tradie-location-label"
                  label=""
                  placeholder="Search service location..."
                  searchValue={siteAddress}
                  selectedItem={selectedLocation}
                  items={locationSuggestions}
                  onQueryChange={setSiteAddress}
                  onSelect={(item) => {
                    const location = item as AddressSuggestion;
                    setSelectedLocation(location);
                    updateField("location", location.address);
                    markTouched("location");
                  }}
                />
                {fieldError("location") && (
                  <p className="text-xs text-destructive">
                    {fieldError("location")}
                  </p>
                )}
              </div>
            </div>
          </section>
          <section>
            <Label htmlFor="tradie-note" className="mb-2 flex gap-2">
              <StickyNote className="h-4 w-4" aria-hidden="true" />
              Internal notes
            </Label>
            <Textarea
              id="tradie-note"
              rows={4}
              maxLength={500}
              placeholder="Availability, reliability notes, preferences..."
              value={formData.note}
              aria-describedby="tradie-note-count"
              onChange={(e) => updateField("note", e.target.value)}
            />
            <p
              id="tradie-note-count"
              className="mt-1 text-right text-xs text-muted-foreground"
            >
              {(formData.note ?? "").length}/500 characters
            </p>
          </section>
          <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() => startTransition(handleSubmit)}
            >
              {isPending ? (
                <>
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Creating…
                </>
              ) : (
                <>
                  <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                  Create tradie
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}