import {
  BriefcaseBusiness,
  Building2,
  DollarSign,
  HardHat,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useMemo, useState, useTransition } from "react";
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { toast } from "sonner";
import { z } from "zod";
import { useAppDispatch } from "@/lib/store/hooks";
import { addTradie } from "@/lib/store/slices/tradieManagementSlice";
import { CreateTradieInput } from "@/types/tradie";
import { AddressSuggestion } from "@/types/data";
import { SearchableSelect } from "@/components/common/searchable-select";
import { fetchJson } from "@/utils/fetch";
import { cn } from "@/lib/utils";

interface AddTradieModalProps {
  open: boolean;
  onClose: () => void;
}

const initialState: CreateTradieInput = {
  name: "",
  trade: "",
  hourlyRate: 0,
  abn: "",
  phone: "",
  email: "",
  location: "",
  note: "",
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
  hourlyRate: z.number().positive("Hourly rate must be greater than 0"),
  abn: z
    .string()
    .refine(
      (value) => /^\d{11}$/.test(normalizeAbn(value)),
      "ABN must be exactly 11 digits",
    ),
  email: z.email("Enter a valid email address"),
  note: z.string().max(500).optional(),
});

type TradieField = keyof CreateTradieInput;

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
        hourlyRate: true,
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
      onClose();
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
              <PlusCircle className="h-5 w-5 text-primary" />
            </div>
            Add New Tradie
          </DialogTitle>
          <DialogDescription>
            Register a contractor profile with contact, trade and pricing
            information.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4" />
              Business Information
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <BriefcaseBusiness className="h-4 w-4" />
                  Business / Tradie Name
                </Label>
                <Input
                  placeholder="Business / Tradie name"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  onBlur={() => markTouched("name")}
                  className={cn(
                    fieldError("name") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {fieldError("name") && (
                  <p className="text-xs text-destructive">
                    {fieldError("name")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <HardHat className="h-4 w-4" />
                  Trade Type
                </Label>
                <Select
                  value={formData.trade}
                  onValueChange={(value) => {
                    updateField("trade", value);
                    markTouched("trade");
                  }}
                >
                  <SelectTrigger
                    className={cn(
                      fieldError("trade") &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  >
                    <SelectValue placeholder="Select trade type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRADIE_TYPES).map(([key, label]) => {
                      const Icon =
                        TRADIE_TYPE_ICONS[key as keyof typeof TRADIE_TYPES];
                      return (
                        <SelectItem key={key} value={label}>
                          <div className="flex gap-2">
                            <Icon className="h-4 w-4" />
                            {label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {fieldError("trade") && (
                  <p className="text-xs text-destructive">
                    {fieldError("trade")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  ABN
                </Label>
                <Input
                  placeholder="11 digit ABN"
                  inputMode="numeric"
                  maxLength={14} // allows for "XX XXX XXX XXX" spacing while typing
                  value={formData.abn}
                  onChange={(e) => {
                    // Only allow digits and spaces as the user types
                    const raw = e.target.value.replace(/[^\d\s]/g, "");
                    updateField("abn", raw);
                  }}
                  onBlur={() => markTouched("abn")}
                  className={cn(
                    fieldError("abn") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {fieldError("abn") ? (
                  <p className="text-xs text-destructive">
                    {fieldError("abn")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Format: XX XXX XXX XXX
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Hourly Rate
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className={cn(
                      "pl-8",
                      fieldError("hourlyRate") &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Hourly rate"
                    value={formData.hourlyRate || ""}
                    onChange={(e) =>
                      updateField(
                        "hourlyRate",
                        e.target.value === "" ? 0 : Number(e.target.value),
                      )
                    }
                    onBlur={() => markTouched("hourlyRate")}
                  />
                </div>
                {fieldError("hourlyRate") && (
                  <p className="text-xs text-destructive">
                    {fieldError("hourlyRate")}
                  </p>
                )}
              </div>
            </div>
          </section>
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Phone className="h-4 w-4" />
              Contact Details
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Phone Number
                </Label>
                <Input
                  placeholder="04XX XXX XXX"
                  inputMode="tel"
                  value={formData.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  onBlur={() => markTouched("phone")}
                  className={cn(
                    fieldError("phone") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {fieldError("phone") ? (
                  <p className="text-xs text-destructive">
                    {fieldError("phone")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Mobile: 04XX XXX XXX &middot; Landline: 02/03/07/08 XXXX
                    XXXX
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Address
                </Label>
                <Input
                  type="email"
                  placeholder="Email address"
                  value={formData.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  onBlur={() => markTouched("email")}
                  className={cn(
                    fieldError("email") &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {fieldError("email") && (
                  <p className="text-xs text-destructive">
                    {fieldError("email")}
                  </p>
                )}
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Tradie Location
                </Label>
                <SearchableSelect
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
            <Label className="mb-2 flex gap-2">
              <StickyNote className="h-4 w-4" />
              Internal Notes
            </Label>
            <Textarea
              rows={4}
              maxLength={500}
              placeholder="Availability, reliability notes, preferences..."
              value={formData.note}
              onChange={(e) => updateField("note", e.target.value)}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {(formData.note ?? "").length}/500
            </p>
          </section>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" disabled={isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() => startTransition(handleSubmit)}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Create Tradie
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
