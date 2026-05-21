"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type SubmitEvent, useState, useTransition } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { FilePlus2, Loader2 } from "lucide-react";

interface AddMaterialModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface AddMaterialFormData {
  category: string;
  productName: string;
  specifications: string;
  quantity?: number;
  unitCost?: number;
  totalCost?: number;
}

const CATEGORIES = [
  "Bricks",
  "Cement",
  "Steel",
  "Wood",
  "Glass",
  "Insulation",
  "Roofing",
  "Flooring",
  "Paint",
];

export function AddMaterialModal({
  projectId,
  isOpen,
  onClose,
}: AddMaterialModalProps) {
  const [isPending, startTransition] = useTransition();
  const [formData, setFormData] = useState<AddMaterialFormData>({
    category: "",
    productName: "",
    specifications: "",
    quantity: undefined,
    unitCost: undefined,
    totalCost: undefined,
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const handleFormStateChange = (
    field: keyof AddMaterialFormData,
    value: string | number,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (data: SubmitEvent<HTMLFormElement>) => {
    // Handle form submission to add material
    // You would typically dispatch a Redux action or call an API here
    console.log("Submitting material for project:", projectId);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[14px] border-border bg-white p-0 shadow-lg sm:max-w-150">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-6 pb-4 pt-5">
          <div>
            <DialogTitle className="text-base font-bold">
              Add Material
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              Add a new material to the project.
            </DialogDescription>
          </div>
        </DialogHeader>
        {/* Form fields for adding material would go here */}
        <form
          className="space-y-4 px-6 pb-6 pt-5"
          onSubmit={(data) =>
            startTransition(async () => await handleSubmit(data))
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Category
              </label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  handleFormStateChange("category", value)
                }
              >
                <SelectTrigger className="h-9 w-full rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Product Name
              </label>
              <Input
                value={formData.productName}
                onChange={(event) =>
                  handleFormStateChange("productName", event.target.value)
                }
                placeholder="Enter the product name..."
                required
                className="resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Specification
              </label>
              <Input
                value={formData.specifications}
                onChange={(event) =>
                  handleFormStateChange("specifications", event.target.value)
                }
                placeholder="e.g. 230mm x 110mm x 75mm for bricks"
                required
                className="resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Quantity
              </label>
              <Input
                value={formData.quantity}
                onChange={(event) => {
                  handleFormStateChange("quantity", event.target.value);
                  if (formData.unitCost) {
                    const totalCost =
                      Number(event.target.value) * formData.unitCost;
                    handleFormStateChange("totalCost", totalCost);
                  }
                }}
                type="number"
                placeholder="e.g. 1000"
                required
                className="resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Unit Cost
              </label>
              <Input
                type="number"
                value={formData.unitCost}
                onChange={(event) => {
                  handleFormStateChange("unitCost", event.target.value);
                  if (formData.quantity) {
                    const totalCost =
                      Number(event.target.value) * formData.quantity;
                    handleFormStateChange("totalCost", totalCost);
                  }
                }}
                placeholder="e.g. $10.50/ea"
                required
                className="resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total Cost
              </label>
              <Input
                type="number"
                value={formData.totalCost}
                disabled
                placeholder="Auto Calculated"
                required
                className="resize-y rounded-[7px] bg-white px-3 py-2 text-[13px] transition-all focus-visible:border-teal-600 focus-visible:ring-4 focus-visible:ring-teal-600/10"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-[7px] px-3.5 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-9 rounded-[7px] bg-[#0D9488] px-3.5 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
            >
              {isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <FilePlus2 className="mr-1.5 size-4" />
              )}
              Add Material
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
