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
import { Label } from "../ui/label";
import { AlertCircle, FilePlus2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addMaterialSchema } from "@/utils/validators/material";
import { useAppDispatch } from "@/lib/store/hooks";
import { addMaterialToProject } from "@/lib/store/slices/projectsSlice";

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

type MaterialFieldErrors = Partial<
  Record<
    "name" | "category" | "specifications" | "quantity" | "unitCost" | "totalCost",
    string
  >
>;

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

const initialFormData: AddMaterialFormData = {
  category: "",
  productName: "",
  specifications: "",
  quantity: undefined,
  unitCost: undefined,
  totalCost: undefined,
};

const fieldClassName = "h-9 rounded-[7px] bg-background px-3 py-2 text-sm";
const labelClassName = "text-xs font-medium text-foreground";

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive-ink" aria-hidden="true">
      *
    </span>
  );
}

export function AddMaterialModal({
  projectId,
  isOpen,
  onClose,
}: AddMaterialModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const [formData, setFormData] =
    useState<AddMaterialFormData>(initialFormData);
  const [fieldErrors, setFieldErrors] = useState<MaterialFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetForm = () => {
    setFormData(initialFormData);
    setFieldErrors({});
    setSubmitError(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
      onClose();
    }
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

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSubmitError(null);
    setFieldErrors({});

    try {
      const data = {
        projectId,
        materialData: {
          name: formData.productName,
          category: formData.category,
          specifications: formData.specifications,
          quantity: formData.quantity,
          unitCost: formData.unitCost,
          totalCost: formData.totalCost,
        },
      };
      const parsedData = addMaterialSchema.safeParse(data);
      if (!parsedData.success) {
        const nextFieldErrors = parsedData.error.issues.reduce(
          (acc: MaterialFieldErrors, issue) => {
            const field = issue.path.at(-1) as
              | keyof MaterialFieldErrors
              | undefined;

            if (field && !acc[field]) {
              acc[field] = issue.message;
            }

            return acc;
          },
          {},
        );

        setFieldErrors(nextFieldErrors);
        setSubmitError("Review the highlighted fields and try again.");
        return;
      }
      const updatedProject = await dispatch(
        addMaterialToProject(parsedData.data),
      ).unwrap();
      toast.success(`Material added to ${updatedProject.name}`);
      resetForm();
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to add material to project";
      setSubmitError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[14px] border-border bg-card p-0 shadow-lg sm:max-w-150">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-5">
          <DialogTitle className="text-lg font-semibold text-foreground">
            Add material
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-muted-foreground">
            Add a new material to the project. Fields marked * are required.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 px-6 pb-6 pt-5"
          noValidate
          onSubmit={(data) => {
            if (isPending) {
              data.preventDefault();
              return;
            }
            startTransition(async () => await handleSubmit(data));
          }}
        >
          {submitError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border border-destructive/40 bg-destructive-light px-3.5 py-3 text-sm text-destructive-ink"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>{submitError}</p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="material-category" className={labelClassName}>
                Category
                <RequiredMark />
              </Label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  handleFormStateChange("category", value)
                }
              >
                <SelectTrigger
                  id="material-category"
                  className={`w-full ${fieldClassName}`}
                  aria-invalid={Boolean(fieldErrors.category)}
                  aria-describedby={
                    fieldErrors.category ? "material-category-error" : undefined
                  }
                >
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
              {fieldErrors.category ? (
                <p
                  id="material-category-error"
                  className="text-xs text-destructive-ink"
                >
                  {fieldErrors.category}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-name" className={labelClassName}>
                Product name
                <RequiredMark />
              </Label>
              <Input
                id="material-name"
                required
                value={formData.productName}
                onChange={(event) =>
                  handleFormStateChange("productName", event.target.value)
                }
                placeholder="Standard clay brick"
                className={fieldClassName}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? "material-name-error" : undefined
                }
              />
              {fieldErrors.name ? (
                <p
                  id="material-name-error"
                  className="text-xs text-destructive-ink"
                >
                  {fieldErrors.name}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-spec" className={labelClassName}>
                Specification
              </Label>
              <Input
                id="material-spec"
                value={formData.specifications}
                onChange={(event) =>
                  handleFormStateChange("specifications", event.target.value)
                }
                placeholder="230mm x 110mm x 75mm"
                className={fieldClassName}
                aria-invalid={Boolean(fieldErrors.specifications)}
                aria-describedby={
                  fieldErrors.specifications
                    ? "material-spec-error"
                    : undefined
                }
              />
              {fieldErrors.specifications ? (
                <p
                  id="material-spec-error"
                  className="text-xs text-destructive-ink"
                >
                  {fieldErrors.specifications}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-quantity" className={labelClassName}>
                Quantity
                <RequiredMark />
              </Label>
              <Input
                id="material-quantity"
                type="number"
                min="1"
                step="1"
                required
                value={formData.quantity ?? ""}
                onChange={(event) => {
                  handleFormStateChange("quantity", event.target.value);
                  if (formData.unitCost) {
                    const totalCost =
                      Number(event.target.value) * formData.unitCost;
                    handleFormStateChange("totalCost", totalCost);
                  }
                }}
                placeholder="1000"
                className={`${fieldClassName} font-mono tabular-nums`}
                aria-invalid={Boolean(fieldErrors.quantity)}
                aria-describedby={
                  fieldErrors.quantity ? "material-quantity-error" : undefined
                }
              />
              {fieldErrors.quantity ? (
                <p
                  id="material-quantity-error"
                  className="text-xs text-destructive-ink"
                >
                  {fieldErrors.quantity}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-unit-cost" className={labelClassName}>
                Unit cost
                <RequiredMark />
              </Label>
              <Input
                id="material-unit-cost"
                type="number"
                min="0"
                step="0.01"
                required
                value={formData.unitCost ?? ""}
                onChange={(event) => {
                  handleFormStateChange("unitCost", event.target.value);
                  if (formData.quantity) {
                    const totalCost =
                      Number(event.target.value) * formData.quantity;
                    handleFormStateChange("totalCost", totalCost);
                  }
                }}
                placeholder="10.50"
                className={`${fieldClassName} font-mono tabular-nums`}
                aria-invalid={Boolean(fieldErrors.unitCost)}
                aria-describedby={
                  fieldErrors.unitCost ? "material-unit-cost-error" : undefined
                }
              />
              {fieldErrors.unitCost ? (
                <p
                  id="material-unit-cost-error"
                  className="text-xs text-destructive-ink"
                >
                  {fieldErrors.unitCost}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="material-total-cost" className={labelClassName}>
                Total cost
              </Label>
              <Input
                id="material-total-cost"
                type="number"
                value={formData.totalCost ?? ""}
                disabled
                readOnly
                className={`${fieldClassName} font-mono tabular-nums`}
                aria-describedby="material-total-cost-hint"
              />
              <p
                id="material-total-cost-hint"
                className="text-xs text-muted-foreground"
              >
                Quantity × unit cost.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-[7px] px-3.5 text-sm font-medium"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              aria-busy={isPending}
              className="h-9 rounded-[7px] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isPending ? (
                <Loader2
                  className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <FilePlus2 className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {isPending ? "Adding material…" : "Add material"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
