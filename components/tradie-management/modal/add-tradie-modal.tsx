import { PlusCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
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
import { TRADIE_TYPE_ICONS, TRADIE_TYPES } from "@/constants/tradieTypes";
import { useState, useTransition } from "react";
import { CreateTradieInput } from "@/types/tradie";
import { useAppDispatch } from "@/lib/store/hooks";
import { toast } from "sonner";
import { addTradie } from "@/lib/store/slices/tradieManagementSlice";

interface AddTradieModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AddTradieModal({ open, onClose }: AddTradieModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const [formData, setFormData] = useState<CreateTradieInput>({
    name: "",
    trade: "",
    hourlyRate: 0,
    abn: "",
    phone: "",
    email: "",
    note: undefined,
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const handleInputChange = <
    K extends Exclude<keyof CreateTradieInput, "hourlyRate">,
  >(
    field: K,
    value: CreateTradieInput[K],
  ) => {
    setFormData((prevData) => ({
      ...prevData,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    try {
      await dispatch(addTradie(formData)).unwrap();
      toast.success("Tradie added successfully!");
      onClose();
    } catch (error) {
      toast.error("Failed to add tradie. Please try again.");
      console.error("Error adding tradie:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-140">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-primary" />
            Add New Tradie
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                Tradie Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. John Smith Electrical"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Trade <span className="text-destructive">*</span>
              </Label>

              <Select
                value={formData.trade}
                onValueChange={(value) => handleInputChange("trade", value)}
              >
                <SelectTrigger className="h-9 flex-none rounded-full border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 focus:ring-1 focus:ring-rc-gold">
                  <SelectValue placeholder="Select Trade" />
                </SelectTrigger>

                <SelectContent className="w-auto min-w-40 rounded-md border border-gray-200 bg-white shadow-lg">
                  {Object.entries(TRADIE_TYPES).map(([key, label]) => {
                    const Icon =
                      TRADIE_TYPE_ICONS[key as keyof typeof TRADIE_TYPES];
                    return (
                      <SelectItem
                        key={key}
                        value={label}
                        className="text-sm text-gray-700"
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="h-3 w-3 text-gray-500" />
                          <span>{label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>ABN</Label>
              <Input
                placeholder="00 000 000 000"
                value={formData.abn}
                onChange={(e) => handleInputChange("abn", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="+61 400 000 000"
                value={formData.phone}
                onChange={(e) => handleInputChange("phone", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={formData.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Hourly Rate ($)
                <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 85"
                value={formData.hourlyRate}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    hourlyRate: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              placeholder="Any additional notes..."
              value={formData.note}
              onChange={(e) => handleInputChange("note", e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>

            <Button
              onClick={() => startTransition(handleSubmit)}
              disabled={isPending}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Tradie
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
