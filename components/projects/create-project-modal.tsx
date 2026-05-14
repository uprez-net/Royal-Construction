"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PhoneNumberInput } from "@/components/common/phone-number-input";
import { SearchableSelect, type LookupOption } from "@/components/common/searchable-select";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { fetchCustomers } from "@/lib/store/slices/customersSlice";
import { fetchSiteManagers } from "@/lib/store/slices/siteManagersSlice";

type CustomerMode = "existing" | "new";

const customerLookupPageSize = 10;
const siteManagerLookupPageSize = 10;

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

  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<LookupOption | null>(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [location, setLocation] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedManager, setSelectedManager] = useState<LookupOption | null>(null);
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [estimatedEndDate, setEstimatedEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const customerItems = useMemo(
    () => customers.items.map((item) => ({ ...item })),
    [customers.items],
  );
  const managerItems = useMemo(
    () => siteManagers.items.map((item) => ({ ...item })),
    [siteManagers.items],
  );

  const resetForm = () => {
    setName("");
    setPropertyType("");
    setCustomerMode("existing");
    setCustomerSearch("");
    setSelectedCustomer(null);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerEmail("");
    setLocation("");
    setManagerSearch("");
    setSelectedManager(null);
    setBudget("");
    setStartDate("");
    setEstimatedEndDate("");
    setNotes("");
    setIsSaving(false);
    setErrorMessage(null);
  };

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }

    const customerTimer = window.setTimeout(() => {
      dispatch(fetchCustomers({ page: 1, limit: customerLookupPageSize, query: customerSearch }));
    }, 250);

    return () => {
      window.clearTimeout(customerTimer);
    };
  }, [open, customerSearch, dispatch]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const managerTimer = window.setTimeout(() => {
      dispatch(fetchSiteManagers({ page: 1, limit: siteManagerLookupPageSize, query: managerSearch }));
    }, 250);

    return () => {
      window.clearTimeout(managerTimer);
    };
  }, [open, managerSearch, dispatch]);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSaving(true);

    const payload =
      customerMode === "existing"
        ? {
            name,
            propertyType,
            customerMode,
            customerId: selectedCustomer?.id,
            location,
            siteManagerId: selectedManager?.id ?? null,
            budget: Number(budget),
            startDate,
            estimatedEndDate: estimatedEndDate || null,
            notes,
          }
        : {
            name,
            propertyType,
            customerMode,
            customerName: newCustomerName,
            customerPhone: newCustomerPhone,
            customerEmail: newCustomerEmail,
            location,
            siteManagerId: selectedManager?.id ?? null,
            budget: Number(budget),
            startDate,
            estimatedEndDate: estimatedEndDate || null,
            notes,
          };

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setIsSaving(false);

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorMessage(body?.error ?? "Unable to create project");
      return;
    }

    resetForm();
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onOpenChange(false)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>Add a new construction project to the system.</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Project Name *</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Penrith Residence" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Property Type *</label>
              <Select value={propertyType} onValueChange={setPropertyType} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4BR Modern Home">4BR Modern Home</SelectItem>
                  <SelectItem value="5BR Luxury Home">5BR Luxury Home</SelectItem>
                  <SelectItem value="Duplex Construction">Duplex Construction</SelectItem>
                  <SelectItem value="4BR + Granny Flat">4BR + Granny Flat</SelectItem>
                  <SelectItem value="6BR Double Storey">6BR Double Storey</SelectItem>
                  <SelectItem value="3BR Apartment Reno">3BR Apartment Reno</SelectItem>
                  <SelectItem value="Townhouse">Townhouse</SelectItem>
                  <SelectItem value="Custom Build">Custom Build</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-1">
            <Button type="button" variant={customerMode === "existing" ? "default" : "ghost"} className="flex-1" onClick={() => setCustomerMode("existing")}>
              Existing Customer
            </Button>
            <Button type="button" variant={customerMode === "new" ? "default" : "ghost"} className="flex-1" onClick={() => setCustomerMode("new")}>
              New Customer
            </Button>
          </div>

          {customerMode === "existing" ? (
            <SearchableSelect
              label="Customer"
              placeholder="Select a customer..."
              searchValue={customerSearch}
              selectedItem={selectedCustomer}
              items={customerItems}
              loading={customers.loading}
              hasMore={customers.page < customers.totalPages}
              onQueryChange={setCustomerSearch}
              onSelect={(item) => {
                setSelectedCustomer(item);
                setCustomerMode("existing");
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
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-foreground">Customer Name *</label>
                <Input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="e.g. Harpreet Kaur" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Customer Phone *</label>
                <PhoneNumberInput value={newCustomerPhone} onChange={setNewCustomerPhone} placeholder="+61 4XX XXX XXX" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Customer Email *</label>
                <Input value={newCustomerEmail} onChange={(event) => setNewCustomerEmail(event.target.value)} type="email" placeholder="email@example.com" required />
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Site Location *</label>
              <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Penrith, NSW 2750" required />
            </div>
            <SearchableSelect
              label="Site Manager"
              placeholder="Assign manager..."
              searchValue={managerSearch}
              selectedItem={selectedManager}
              items={managerItems}
              loading={siteManagers.loading}
              hasMore={siteManagers.page < siteManagers.totalPages}
              onQueryChange={setManagerSearch}
              onSelect={setSelectedManager}
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
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Budget (AUD) *</label>
              <Input value={budget} onChange={(event) => setBudget(event.target.value)} type="number" min="0" placeholder="e.g. 485000" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Start Date *</label>
              <Input value={startDate} onChange={(event) => setStartDate(event.target.value)} type="date" required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Est. Completion</label>
              <Input value={estimatedEndDate} onChange={(event) => setEstimatedEndDate(event.target.value)} type="date" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Special Requirements / Notes</label>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Any specific customer requirements, site conditions, etc." />
          </div>

          {errorMessage ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => setErrorMessage("Save draft is not wired yet")}>Save Draft</Button>
            <Button type="submit" disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}