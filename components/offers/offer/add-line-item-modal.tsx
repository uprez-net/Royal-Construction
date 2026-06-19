import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LineItem, useChatContext } from "@/context/ChatContext";
import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { currency } from "@/utils/formatters";
import { Label } from "@/components/ui/label";
import { DollarSign, Package2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LINE_ITEM_UNIT_LABELS, LineItemUnit } from "./editable-line-item-row";

interface AddLineItemModalProps {
  open: boolean;
  handleOpenChange: (isOpen: boolean) => void;
  onSave: () => void;
}

const GST_RATE = 0.1;

type LineItemForm = Pick<
  LineItem,
  "item" | "description" | "quantity" | "unitPrice" | "unit"
>;

const INITIAL_FORM: LineItemForm = {
  item: "",
  description: "",
  quantity: 1,
  unitPrice: 0,
  unit: "each",
};

const calculateLineItemValues = (
  quantity: number,
  unitPrice: number,
  gstRate = GST_RATE,
  returnNumeric = false,
) => {
  const netLine = quantity * unitPrice;
  const gstAmount = netLine * gstRate;
  const totalPrice = netLine + gstAmount;

  if (returnNumeric) {
    return {
      netLine,
      gstAmount,
      totalPrice,
    };
  }

  return {
    netLine: currency.format(netLine),
    gstAmount: currency.format(gstAmount),
    totalPrice: currency.format(totalPrice),
  };
};

export function AddLineItemModal({
  open,
  handleOpenChange,
  onSave
}: AddLineItemModalProps) {
  const { addLineItem } = useChatContext();
  const [form, setForm] = useState<LineItemForm>(INITIAL_FORM);

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) {
      setForm(INITIAL_FORM);
      handleOpenChange(false);
    }
    handleOpenChange(isOpen);
  };

  const handleFormChange = <K extends keyof LineItemForm>(
    field: K,
    value: LineItemForm[K],
  ) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = () => {
    const { netLine, gstAmount, totalPrice } = calculateLineItemValues(
      form.quantity,
      form.unitPrice,
      GST_RATE,
      true,
    );

    const newItem: LineItem = {
      id: uuidv4(),
      ...form,
      gstRate: GST_RATE,
      gstIncluded: true,
      netLine: netLine as number,
      gstAmount: gstAmount as number,
      totalPrice: totalPrice as number,
    };

    addLineItem(newItem);
    onSave();

    setForm(INITIAL_FORM);
    handleOpenChange(false);
  };

  const preview = calculateLineItemValues(form.quantity, form.unitPrice);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-h-[80vh] max-w-md">
        <DialogHeader>
          <DialogTitle>Add Line Item</DialogTitle>
          <DialogDescription>
            Add a new line item to your offer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="item">Item Name</Label>
            <Input
              id="item"
              placeholder="e.g. Kitchen Bench"
              value={form.item}
              onChange={(e) => handleFormChange("item", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>

            <Textarea
              id="description"
              placeholder="Describe the product or service..."
              value={form.description}
              onChange={(e) => handleFormChange("description", e.target.value)}
              rows={4}
              className="resize-none"
            />

            <p className="text-muted-foreground text-xs">
              Include specifications, scope of work, materials, or other
              relevant details.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) =>
                  handleFormChange("quantity", Number(e.target.value) || 0)
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <div className="relative">
                <Package2 className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Select
                  value={form.unit as LineItemUnit}
                  onValueChange={(v) =>
                    handleFormChange("unit", v as LineItemUnit)
                  }
                >
                  <SelectTrigger className="h-8 w-36 pl-9">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {(Object.keys(LINE_ITEM_UNIT_LABELS) as LineItemUnit[]).map(
                      (unit) => (
                        <SelectItem key={unit} value={unit}>
                          {LINE_ITEM_UNIT_LABELS[unit]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unitPrice">Unit Price</Label>

            <div className="relative">
              <DollarSign className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />

              <Input
                id="unitPrice"
                type="number"
                min={0}
                className="pl-9"
                placeholder="0.00"
                value={form.unitPrice}
                onChange={(e) =>
                  handleFormChange("unitPrice", Number(e.target.value) || 0)
                }
              />
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-medium">Pricing Summary</h4>
              <span className="text-muted-foreground text-xs">
                GST {(GST_RATE * 100).toFixed(0)}%
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net Amount</span>
                <span className="font-medium">{preview.netLine}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">GST</span>
                <span>{preview.gstAmount}</span>
              </div>

              <div className="bg-border my-2 h-px" />

              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span>{preview.totalPrice}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>

          <Button onClick={handleSave} disabled={!form.item.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
