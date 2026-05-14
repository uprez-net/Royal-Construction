"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { PhoneNumberInput } from "@/components/common/phone-number-input";
import {
  SearchableSelect,
  type LookupOption,
} from "@/components/common/searchable-select";

import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { fetchCustomers } from "@/lib/store/slices/customersSlice";
import { fetchSiteManagers } from "@/lib/store/slices/siteManagersSlice";

import type { AddressSuggestion } from "@/types/data";

const customerLookupPageSize = 10;
const siteManagerLookupPageSize = 10;

const lookUpItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
});

const locationSuggestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  address: z.string(),
  council: z.string(),
  state: z.string(),
  countryCode: z.string(),
  postcode: z.string().nullable(),
});

const formSchema = z
  .object({
    name: z.string().min(1, "Project name is required"),

    propertyType: z.string().min(1, "Property type is required"),

    customerMode: z.enum(["existing", "new"]),

    selectedCustomer: lookUpItemSchema.nullable(),

    newCustomerName: z.string().optional(),
    newCustomerPhone: z.string().optional(),
    newCustomerEmail: z.string().optional(),

    location: z.string().min(1, "Location is required"),

    selectedLocationSuggestion: locationSuggestionSchema.nullable(),

    selectedManager: lookUpItemSchema.nullable(),

    budget: z.coerce
      .number({
        message: "Budget is required",
      })
      .min(1, "Budget must be greater than 0"),

    lotSize: z.coerce
      .number({
        message: "Lot size is required",
      })
      .min(1, "Lot size must be greater than 0"),

    startDate: z.string().min(1, "Start date is required"),

    estimatedEndDate: z.string().optional(),

    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.customerMode === "existing" && !data.selectedCustomer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedCustomer"],
        message: "Please select a customer",
      });
    }

    if (data.customerMode === "new") {
      if (!data.newCustomerName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newCustomerName"],
          message: "Customer name is required",
        });
      }

      if (!data.newCustomerPhone?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newCustomerPhone"],
          message: "Customer phone is required",
        });
      }

      if (!data.newCustomerEmail?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["newCustomerEmail"],
          message: "Customer email is required",
        });
      }
    }

    // Location & Site Manager
    if (!data.selectedLocationSuggestion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedLocationSuggestion"],
        message: "Please select a valid location from suggestions",
      });
    }

    if (!data.selectedManager) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedManager"],
        message: "Please select a site manager",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const defaultValues: FormValues = {
  name: "",
  propertyType: "",

  customerMode: "existing",

  selectedCustomer: null,

  newCustomerName: "",
  newCustomerPhone: "",
  newCustomerEmail: "",

  location: "",
  selectedLocationSuggestion: null,

  selectedManager: null,

  budget: undefined as unknown as number,
  lotSize: undefined as unknown as number,

  startDate: "",
  estimatedEndDate: "",

  notes: "",
};

export function CreateProjectModal({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const dispatch = useAppDispatch();

  const customers = useAppSelector((state) => state.customers);

  const siteManagers = useAppSelector((state) => state.siteManagers);

  const [isPending, startTransition] = useTransition();

  const [customerSearch, setCustomerSearch] = useState("");

  const [managerSearch, setManagerSearch] = useState("");

  const [locationSuggestions, setLocationSuggestions] = useState<
    AddressSuggestion[]
  >([]);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues,
  });

  const customerMode = useWatch({
    control,
    name: "customerMode",
  });

  const location = useWatch({
    control,
    name: "location",
  });

  const customerItems = useMemo(
    () => customers.items.map((item) => ({ ...item })),
    [customers.items],
  );

  const managerItems = useMemo(
    () =>
      siteManagers.items.map((item) => ({
        ...item,
      })),
    [siteManagers.items],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      void dispatch(
        fetchCustomers({
          page: 1,
          limit: customerLookupPageSize,
          query: customerSearch,
        }),
      );
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dispatch, customerSearch, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      void dispatch(
        fetchSiteManagers({
          page: 1,
          limit: siteManagerLookupPageSize,
          query: managerSearch,
        }),
      );
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dispatch, managerSearch, open]);

  useEffect(() => {
    if (!open || location.length < 3) {
      setLocationSuggestions([]);
      return;
    }

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/address/suggestions?query=${encodeURIComponent(location)}`,
          {
            signal: controller.signal,
          },
        );

        const data: {
          suggestions: AddressSuggestion[];
        } = await response.json();

        setLocationSuggestions(data.suggestions);
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Failed to fetch location suggestions", error);

          setLocationSuggestions([]);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [location, open]);

  useEffect(() => {
    if (!open) {
      reset(defaultValues);

      setCustomerSearch("");
      setManagerSearch("");
      setLocationSuggestions([]);
    }
  }, [open, reset]);

  const onSubmit = async (values: FormValues) => {
    clearErrors("root");

    startTransition(async () => {
      try {
        const payload =
          values.customerMode === "existing"
            ? {
                name: values.name,
                propertyType: values.propertyType,

                customerMode: values.customerMode,

                customerId: values.selectedCustomer?.id,

                location: `${values.selectedLocationSuggestion?.address ?? ""}, ${values.selectedLocationSuggestion?.state ?? ""} ${values.selectedLocationSuggestion?.postcode ?? ""}`,
                council: values.selectedLocationSuggestion?.council ?? "",

                siteManagerId: values.selectedManager?.id ?? null,

                budget: values.budget,
                lotSize: values.lotSize,

                startDate: values.startDate,

                estimatedEndDate: values.estimatedEndDate || null,

                notes: values.notes,
              }
            : {
                name: values.name,
                propertyType: values.propertyType,

                customerMode: values.customerMode,

                customerName: values.newCustomerName,

                customerPhone: values.newCustomerPhone,

                customerEmail: values.newCustomerEmail,

                location: `${values.selectedLocationSuggestion?.address ?? ""}, ${values.selectedLocationSuggestion?.state ?? ""} ${values.selectedLocationSuggestion?.postcode ?? ""}`,
                council: values.selectedLocationSuggestion?.council ?? "",

                siteManagerId: values.selectedManager?.id ?? null,

                budget: values.budget,
                lotSize: values.lotSize,

                startDate: values.startDate,

                estimatedEndDate: values.estimatedEndDate || null,

                notes: values.notes,
              };

        const response = await fetch("/api/projects", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);

          setError("root", {
            message: body?.error ?? "Unable to create project",
          });

          return;
        }

        reset(defaultValues);

        onOpenChange(false);

        onSuccess();
      } catch (error) {
        console.error(error);

        setError("root", {
          message: "Something went wrong",
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>

          <DialogDescription>
            Add a new construction project to the system.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Name *</label>

              <Input
                {...register("name")}
                placeholder="e.g. Penrith Residence"
              />

              {errors.name && (
                <p className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Property Type *</label>

              <Controller
                control={control}
                name="propertyType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="4BR Modern Home">
                        4BR Modern Home
                      </SelectItem>

                      <SelectItem value="5BR Luxury Home">
                        5BR Luxury Home
                      </SelectItem>

                      <SelectItem value="Duplex Construction">
                        Duplex Construction
                      </SelectItem>

                      <SelectItem value="4BR + Granny Flat">
                        4BR + Granny Flat
                      </SelectItem>

                      <SelectItem value="6BR Double Storey">
                        6BR Double Storey
                      </SelectItem>

                      <SelectItem value="3BR Apartment Reno">
                        3BR Apartment Reno
                      </SelectItem>

                      <SelectItem value="Townhouse">Townhouse</SelectItem>

                      <SelectItem value="Custom Build">Custom Build</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />

              {errors.propertyType && (
                <p className="text-sm text-destructive">
                  {errors.propertyType.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-1">
            <Button
              type="button"
              className="flex-1"
              variant={customerMode === "existing" ? "default" : "ghost"}
              onClick={() => setValue("customerMode", "existing")}
            >
              Existing Customer
            </Button>

            <Button
              type="button"
              className="flex-1"
              variant={customerMode === "new" ? "default" : "ghost"}
              onClick={() => setValue("customerMode", "new")}
            >
              New Customer
            </Button>
          </div>

          {customerMode === "existing" ? (
            <div className="space-y-2">
              <Controller
                control={control}
                name="selectedCustomer"
                render={({ field }) => (
                  <SearchableSelect
                    label="Customer"
                    placeholder="Select a customer..."
                    searchValue={customerSearch}
                    selectedItem={field.value}
                    items={customerItems}
                    loading={customers.loading}
                    hasMore={customers.page < customers.totalPages}
                    onQueryChange={setCustomerSearch}
                    onSelect={(item) => {
                      field.onChange(item);

                      setCustomerSearch((item as LookupOption).name);
                    }}
                    onLoadMore={() => {
                      void dispatch(
                        fetchCustomers({
                          page: customers.page + 1,
                          limit: customerLookupPageSize,
                          query: customerSearch,
                        }),
                      );
                    }}
                  />
                )}
              />

              {errors.selectedCustomer && (
                <p className="text-sm text-destructive">
                  {errors.selectedCustomer.message}
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Customer Name *</label>

                <Input
                  {...register("newCustomerName")}
                  placeholder="e.g. Harpreet Kaur"
                />

                {errors.newCustomerName && (
                  <p className="text-sm text-destructive">
                    {errors.newCustomerName.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Customer Phone *</label>

                <Controller
                  control={control}
                  name="newCustomerPhone"
                  render={({ field }) => (
                    <PhoneNumberInput
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="+61 4XX XXX XXX"
                    />
                  )}
                />

                {errors.newCustomerPhone && (
                  <p className="text-sm text-destructive">
                    {errors.newCustomerPhone.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Customer Email *</label>

                <Input
                  {...register("newCustomerEmail")}
                  type="email"
                  placeholder="email@example.com"
                />

                {errors.newCustomerEmail && (
                  <p className="text-sm text-destructive">
                    {errors.newCustomerEmail.message}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Controller
                control={control}
                name="selectedLocationSuggestion"
                render={({ field }) => (
                  <SearchableSelect
                    label="Site Location"
                    placeholder="e.g. Penrith, NSW 2750"
                    searchValue={location}
                    selectedItem={field.value as AddressSuggestion | null}
                    items={locationSuggestions}
                    onQueryChange={(query) => {
                      setValue("location", query);
                    }}
                    onSelect={(item) => {
                      const suggestion = item as AddressSuggestion;

                      field.onChange(suggestion);

                      setValue("location", suggestion.address);
                    }}
                  />
                )}
              />

              {errors.location && (
                <p className="text-sm text-destructive">
                  {errors.location.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Controller
                control={control}
                name="selectedManager"
                render={({ field }) => (
                  <SearchableSelect
                    label="Site Manager"
                    placeholder="Assign manager..."
                    searchValue={managerSearch}
                    selectedItem={field.value}
                    items={managerItems}
                    loading={siteManagers.loading}
                    hasMore={siteManagers.page < siteManagers.totalPages}
                    onQueryChange={setManagerSearch}
                    onSelect={(item) => {
                      field.onChange(item);

                      setManagerSearch((item as LookupOption).name);
                    }}
                    onLoadMore={() => {
                      void dispatch(
                        fetchSiteManagers({
                          page: siteManagers.page + 1,
                          limit: siteManagerLookupPageSize,
                          query: managerSearch,
                        }),
                      );
                    }}
                  />
                )}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Budget (AUD) *</label>

              <Input
                {...register("budget")}
                type="number"
                min="0"
                placeholder="e.g. 485000"
              />

              {errors.budget && (
                <p className="text-sm text-destructive">
                  {errors.budget.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Lot Size (m²) *</label>

              <Input
                {...register("lotSize")}
                type="number"
                min="0"
                placeholder="e.g. 620"
              />

              {errors.lotSize && (
                <p className="text-sm text-destructive">
                  {errors.lotSize.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Start Date *</label>

              <Input {...register("startDate")} type="date" />

              {errors.startDate && (
                <p className="text-sm text-destructive">
                  {errors.startDate.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Est. Completion</label>

              <Input {...register("estimatedEndDate")} type="date" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Special Requirements / Notes
            </label>

            <Textarea
              {...register("notes")}
              rows={4}
              placeholder="Any specific customer requirements, site conditions, etc."
            />
          </div>

          {errors.root?.message && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {errors.root.message}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setError("root", {
                  message: "Save draft is not wired yet",
                })
              }
            >
              Save Draft
            </Button>

            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
