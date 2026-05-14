"use client";

import React, { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CreateProjectModal({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState("");
  const [managerId, setManagerId] = useState("");
  const [budget, setBudget] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);

    const payload = {
      name,
      type,
      customerName: customer,
      customerPhone: phone,
      customerEmail: email,
      location,
      siteManagerId: managerId || null,
      budget: budget ? Number(budget) : 0,
      startDate,
      estEnd: endDate || null,
      notes,
    };

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setIsSaving(false);

    if (!res.ok) {
      // basic error handling
      const err = await res.json().catch(() => null);
      console.error("Failed to create project", err);
      return;
    }

    onOpenChange(false);
    // trigger parent to refresh list
    onSuccess();
    // reset fields
    setName("");
    setType("");
    setCustomer("");
    setPhone("");
    setEmail("");
    setLocation("");
    setManagerId("");
    setBudget("");
    setStartDate("");
    setEndDate("");
    setNotes("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>Add a new construction project to the system.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Project Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium">Property Type *</label>
              <Select onValueChange={(v) => setType(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4BR Modern Home">4BR Modern Home</SelectItem>
                  <SelectItem value="5BR Luxury Home">5BR Luxury Home</SelectItem>
                  <SelectItem value="Duplex Construction">Duplex Construction</SelectItem>
                  <SelectItem value="4BR + Granny Flat">4BR + Granny Flat</SelectItem>
                  <SelectItem value="Custom Build">Custom Build</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Customer Name *</label>
              <Input value={customer} onChange={(e) => setCustomer(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium">Customer Phone *</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium">Customer Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </div>
            <div>
              <label className="text-sm font-medium">Site Location *</label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} required />
            </div>
            <div>
              <label className="text-sm font-medium">Site Manager</label>
              <Select onValueChange={(v) => setManagerId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Assign manager..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {/* TODO: populate from API if needed */}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Budget (AUD) *</label>
              <Input value={budget as any} onChange={(e) => setBudget(Number(e.target.value) || "")} type="number" required />
            </div>
            <div>
              <label className="text-sm font-medium">Start Date *</label>
              <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date" required />
            </div>
            <div>
              <label className="text-sm font-medium">Est. Completion</label>
              <Input value={endDate} onChange={(e) => setEndDate(e.target.value)} type="date" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium">Special Requirements / Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => { /* save draft not implemented */ }}>
              Save Draft
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="animate-spin" /> : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
