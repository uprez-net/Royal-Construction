"use client";

import { useState } from "react";
import { FilePlus2, Loader2, Info } from "lucide-react";

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

export function CreateVariationModal({
  projectId,
  open,
  onOpenChange,
  onSuccess,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("client-request");
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!description.trim() || Number.isNaN(Number(cost)) || Number(cost) <= 0) {
      return;
    }

    setIsSaving(true);

    const response = await fetch(`/api/projects/${projectId}/variations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        cost: Number(cost),
        requestedDate: new Date().toISOString(),
      }),
    });

    setIsSaving(false);

    if (!response.ok) {
      return;
    }

    onOpenChange(false);
    setDescription("");
    setReason("client-request");
    setNotes("");
    setCost("");
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-white p-0 sm:max-w-[600px] rounded-[14px] shadow-lg">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-5 flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-base font-bold">Create Variation</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              This will generate a new quote and notify the customer
            </DialogDescription>
          </div>
        </DialogHeader>
        <form className="space-y-4 px-6 pb-6 pt-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="variation-description" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Variation Description
            </label>
            <Input
              id="variation-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. Upgrade kitchen benchtop to quartz"
              className="rounded-[7px] text-[13px] px-3 py-2 transition-all focus-visible:ring-4 focus-visible:ring-teal-600/10 focus-visible:border-teal-600 h-9 bg-white"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="variation-reason" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Reason
              </label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="variation-reason" className="w-full rounded-[7px] text-[13px] px-3 py-2 transition-all focus:ring-4 focus:ring-teal-600/10 focus:border-teal-600 h-9 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client-request">Client Request</SelectItem>
                  <SelectItem value="site-condition">Site Condition</SelectItem>
                  <SelectItem value="design-change">Design Change</SelectItem>
                  <SelectItem value="council-requirement">Council Requirement</SelectItem>
                  <SelectItem value="material-unavailable">Material Unavailable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="variation-cost" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
                Cost Impact ($)
              </label>
              <Input
                id="variation-cost"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="rounded-[7px] text-[13px] px-3 py-2 transition-all focus-visible:ring-4 focus-visible:ring-teal-600/10 focus-visible:border-teal-600 h-9 bg-white"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="variation-notes" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Notes
            </label>
            <Textarea
              id="variation-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Additional details about this variation..."
              rows={3}
              className="rounded-[7px] text-[13px] px-3 py-2 transition-all focus-visible:ring-4 focus-visible:ring-teal-600/10 focus-visible:border-teal-600 resize-y min-h-[80px] bg-white"
            />
          </div>

          <div className="rounded-[8px] bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-900 flex items-start gap-1.5">
            <Info className="size-4 shrink-0 text-amber-600 mt-0.5" />
            <p>
              A new quote will be created with this variation. The timeline will be automatically adjusted based on the customer's reply date.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="rounded-[7px] text-[12.5px] font-medium hover:text-teal-600 hover:border-teal-600 hover:bg-slate-50 transition-all h-9 px-3.5"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSaving || !description.trim()}
              className="rounded-[7px] text-[12.5px] font-semibold bg-[#0D9488] hover:bg-[#0F766E] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)] transition-all h-9 px-3.5 text-white"
            >
              {isSaving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <FilePlus2 className="mr-1.5 size-4" />}
              Create Variation & Send Quote
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
