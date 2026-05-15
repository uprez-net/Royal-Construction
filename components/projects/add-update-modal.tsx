"use client";

import { useState, useRef } from "react";
import { Loader2, CloudUpload, Send } from "lucide-react";

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

export function AddUpdateModal({
  projectId,
  milestones,
  open,
  onOpenChange,
  onSuccess,
}: {
  projectId: string;
  milestones: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [milestoneId, setMilestoneId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    const formData = new FormData();
    formData.append("title", title);
    formData.append("notes", notes);
    if (milestoneId) {
      formData.append("milestoneId", milestoneId);
    }
    photos.forEach((photo) => formData.append("photos", photo));

    const response = await fetch(`/api/projects/${projectId}/updates`, {
      method: "POST",
      body: formData,
    });

    setIsSaving(false);

    if (!response.ok) {
      return;
    }

    onOpenChange(false);
    setTitle("");
    setNotes("");
    setMilestoneId(undefined);
    setPhotos([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-white p-0 sm:max-w-[600px] rounded-[14px] shadow-lg">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-5 flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-base font-bold">Add Site Update</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              This will notify the customer and team
            </DialogDescription>
          </div>
        </DialogHeader>
        <form className="space-y-4 px-6 pb-6 pt-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">Milestone</label>
            <Select value={milestoneId ?? "__none__"} onValueChange={(value) => setMilestoneId(value === "__none__" ? undefined : value)}>
              <SelectTrigger className="w-full rounded-[7px] text-[13px] px-3 py-2 transition-all focus:ring-4 focus:ring-teal-600/10 focus:border-teal-600 h-9 bg-white">
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No milestone</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">Update Title</label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Frame inspection passed"
              required
              className="rounded-[7px] text-[13px] px-3 py-2 transition-all focus-visible:ring-4 focus-visible:ring-teal-600/10 focus-visible:border-teal-600 h-9 bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">Description</label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Describe the progress, issues, next steps..."
              rows={4}
              required
              className="rounded-[7px] text-[13px] px-3 py-2 transition-all focus-visible:ring-4 focus-visible:ring-teal-600/10 focus-visible:border-teal-600 resize-y min-h-[80px] bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">Attach Photos (required for milestone completion)</label>
            <div 
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer transition-colors hover:bg-slate-50 hover:border-teal-600 group"
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUpload className="mx-auto size-7 text-muted-foreground mb-1.5 group-hover:text-teal-600 transition-colors" />
              <span className="text-xs text-muted-foreground group-hover:text-teal-600 transition-colors">
                {photos.length > 0 ? `${photos.length} photo(s) selected` : "Click to upload photos (max 5)"}
              </span>
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              ref={fileInputRef}
              onChange={(event) => setPhotos(Array.from(event.target.files ?? []))}
              className="hidden"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border mt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="rounded-[7px] text-[12.5px] font-medium hover:text-teal-600 hover:border-teal-600 hover:bg-slate-50 transition-all h-9 px-3.5 mt-4"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSaving}
              className="rounded-[7px] text-[12.5px] font-semibold bg-[#0D9488] hover:bg-[#0F766E] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)] transition-all h-9 px-3.5 mt-4 text-white"
            >
              {isSaving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Send className="mr-1.5 size-4" />}
              Post Update & Notify
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
