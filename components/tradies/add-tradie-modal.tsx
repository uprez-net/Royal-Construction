"use client";
import { useState, useTransition } from "react";
import { Plus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createTradie } from "@/lib/data/tradie-management";
import type { CreateTradieInput } from "@/types/tradie";
const TRADE_TYPES = [
  "Electrical",
  "Plumbing",
  "HVAC",
  "Carpentry",
  "Painting",
  "Landscaping",
  "Roofing",
];
const PRIORITY_OPTIONS = ["Low", "Medium", "High"];
interface AddTradieModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}
export function AddTradieModal({
  open,
  onOpenChange,
  onSuccess,
}: AddTradieModalProps) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  // Form state
  const [tradieName, setTradieName] = useState("");
  const [trade, setTrade] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [abn, setAbn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [notes, setNotes] = useState("");
  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const resetForm = () => {
    setTradieName("");
    setTrade("");
    setCompanyName("");
    setAbn("");
    setPhone("");
    setEmail("");
    setHourlyRate("");
    setPriority("Medium");
    setNotes("");
    setErrors({});
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!tradieName.trim()) {
      newErrors.tradieName = "Tradie name is required";
    }
    if (!trade) {
      newErrors.trade = "Trade type is required";
    }
    if (!phone.trim()) {
      newErrors.phone = "Phone number is required";
    }
    if (!hourlyRate || Number(hourlyRate) <= 0) {
      newErrors.hourlyRate = "Valid hourly rate is required";
    }
    if (!priority) {
      newErrors.priority = "Priority is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateForm()) {
      toast.error("Please fill in all required fields");
      return;
    }
    setLoading(true);
    startTransition(async () => {
      try {
        const input: CreateTradieInput = {
          name: tradieName.trim(),
          trade,
          abn: abn.trim(),
          phone: phone.trim(),
          email: email.trim(),
          hourlyRate: Number(hourlyRate),
          notes: notes.trim() || undefined,
        };
        await createTradie(input);
        toast.success("Tradie added successfully!");
        handleOpenChange(false);
        resetForm();
        onSuccess?.();
      } catch (error) {
        console.error("Error creating tradie:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to add tradie";
        toast.error(errorMessage);
      } finally {
        setLoading(false);
      }
    });
  };
  const isSubmitting = loading || isPending;
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-teal-600" />
            <DialogTitle>Add New Tradie</DialogTitle>
          </div>
          {/* <button
            onClick={() => handleOpenChange(false)}
            className="rounded-md p-1 hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button> */}
        </DialogHeader>
        <form className="space-y-6" onSubmit={handleSubmit}>
          {/* Row 1: Tradie Name & Trade */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">
                Tradie Name <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. John Smith Electrical"
                value={tradieName}
                onChange={(e) => {
                  setTradieName(e.target.value);
                  if (errors.tradieName) {
                    setErrors({ ...errors, tradieName: "" });
                  }
                }}
                className={cn(
                  "rounded-lg border-teal-200 focus-visible:ring-teal-500/10",
                  errors.tradieName && "border-red-500"
                )}
              />
              {errors.tradieName && (
                <p className="text-xs text-red-500">{errors.tradieName}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">
                Trade <span className="text-red-500">*</span>
              </label>
              <Select value={trade} onValueChange={setTrade}>
                <SelectTrigger
                  className={cn(
                    "rounded-lg border-teal-200 focus:ring-teal-500/10",
                    errors.trade && "border-red-500"
                  )}
                >
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {TRADE_TYPES.map((tradeType) => (
                    <SelectItem key={tradeType} value={tradeType}>
                      {tradeType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.trade && (
                <p className="text-xs text-red-500">{errors.trade}</p>
              )}
            </div>
          </div>
          {/* Row 2: Company Name & ABN */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">
                Company Name
              </label>
              <Input
                type="text"
                placeholder="Pty Ltd name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="rounded-lg border-teal-200 focus-visible:ring-teal-500/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">ABN</label>
              <Input
                type="text"
                placeholder="00 000 000 000"
                value={abn}
                onChange={(e) => setAbn(e.target.value)}
                className="rounded-lg border-teal-200 focus-visible:ring-teal-500/10"
              />
            </div>
          </div>
          {/* Row 3: Phone & Email */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">
                Phone <span className="text-red-500">*</span>
              </label>
              <Input
                type="tel"
                placeholder="+61 400 000 000"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (errors.phone) {
                    setErrors({ ...errors, phone: "" });
                  }
                }}
                className={cn(
                  "rounded-lg border-teal-200 focus-visible:ring-teal-500/10",
                  errors.phone && "border-red-500"
                )}
              />
              {errors.phone && (
                <p className="text-xs text-red-500">{errors.phone}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-900">
                Email
              </label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border-teal-200 focus-visible:ring-teal-500/10"
              />
            </div>
          </div>
          {/* Row 4: Hourly Rate & Priority */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">
                Hourly Rate ($) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                placeholder="e.g. 85"
                value={hourlyRate}
                onChange={(e) => {
                  setHourlyRate(e.target.value);
                  if (errors.hourlyRate) {
                    setErrors({ ...errors, hourlyRate: "" });
                  }
                }}
                min="0"
                step="0.01"
                className={cn(
                  "rounded-lg border-teal-200 focus-visible:ring-teal-500/10",
                  errors.hourlyRate && "border-red-500"
                )}
              />
              {errors.hourlyRate && (
                <p className="text-xs text-red-500">{errors.hourlyRate}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">
                Priority <span className="text-red-500">*</span>
              </label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="rounded-lg border-teal-200 focus:ring-teal-500/10">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.priority && (
                <p className="text-xs text-red-500">{errors.priority}</p>
              )}
            </div>
          </div>
          {/* Row 5: Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-900">Notes</label>
            <Textarea
              placeholder="Any additional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={cn(
                "min-h-24 resize-none rounded-lg border-teal-200",
                "px-3 py-2 text-sm text-foreground",
                "focus-visible:border-teal-600",
                "focus-visible:ring-[3px]",
                "focus-visible:ring-teal-500/10"
              )}
            />
          </div>
          {/* Buttons */}
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-teal-600 hover:bg-teal-700"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add Tradie
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}