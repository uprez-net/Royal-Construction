"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    const formData = new FormData();
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
    setNotes("");
    setMilestoneId(undefined);
    setPhotos([]);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Site Update</DialogTitle>
          <DialogDescription>Record progress, attach site photos, and close out a photo-required milestone when needed.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Milestone</label>
            <Select value={milestoneId ?? "__none__"} onValueChange={(value) => setMilestoneId(value === "__none__" ? undefined : value)}>
              <SelectTrigger className="w-full">
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
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Notes</label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Describe what changed on site"
              rows={5}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Photos</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => setPhotos(Array.from(event.target.files ?? []))}
              className="block w-full rounded-lg border border-input px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">Image files only.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              Post Update
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
