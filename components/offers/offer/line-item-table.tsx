import { DataTable } from "@/components/common/data-table";
import { EditableLineItemRow, LineItemUnit } from "./editable-line-item-row";
import { currency } from "@/utils/formatters";
import { Plus, ReceiptText, Sparkles } from "lucide-react";
import { useChatContext } from "@/context/ChatContext";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { AddLineItemModal } from "./add-line-item-modal";
import { v4 as uuidv4 } from "uuid";

const REGENERATION_MESSAGE = `
Please re-generate the offer based on the current line items.
Make sure to update the offer file with the new line items and their details.
Use all the new information to generate an accurate and up-to-date offer for the customer.
`;

export function LineItemTable() {
  const { lineItems, updateLineItem, sendMessage } = useChatContext();
  const [modalOpen, setModalOpen] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);

  const handleSave = () => {
    setUpdateCount((count) => count + 1);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border py-4">
      <div className="flex items-center justify-between px-4 py-2 sm:px-5">
        <h2 className="text-lg font-semibold tracking-tight">Line Items</h2>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={updateCount === 0}
            onClick={() =>
              sendMessage({
                id: uuidv4(),
                parts: [{ type: "text", text: REGENERATION_MESSAGE }],
                metadata: {
                  createdAt: new Date().toISOString(),
                },
              })
            }
          >
            <Sparkles className="size-4" />
            Re-Generate Offer
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="size-4" />
            Add Line Item
          </Button>
        </div>
      </div>
      <div className="min-h-0 w-full flex-1 overflow-auto bg-muted/30 px-4 py-4 lg:px-5 no-scrollbar">
        <DataTable
          headers={[
            "item",
            "description",
            "quantity",
            "price",
            "unit",
            "gst",
            "total",
          ]}
          rows={lineItems.map((item) => [
            item.item,
            item.description,
            <EditableLineItemRow
              key={item.id}
              type="numeric"
              currentValue={item.quantity}
              onValueChange={(value) => {
                handleSave();
                updateLineItem(item.id, { quantity: value });
              }}
            />,
            <EditableLineItemRow
              key={`${item.id}-price`}
              type="numeric"
              currentValue={item.unitPrice}
              onValueChange={(value) => {
                handleSave();
                updateLineItem(item.id, { unitPrice: value });
              }}
              isCurrency={true}
            />,
            <EditableLineItemRow
              key={`${item.id}-unit`}
              type="unit"
              currentValue={item.unit as unknown as LineItemUnit}
              onValueChange={(value) => {
                handleSave();
                updateLineItem(item.id, { unit: value });
              }}
            />,
            currency.format(item.gstAmount),
            currency.format(item.totalPrice),
          ])}
          emptyState={
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="flex size-12 items-center justify-center">
                <ReceiptText className="size-5 text-muted-foreground" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No line items available
                </p>

                <p className="text-xs text-muted-foreground">
                  Your line items will appear here.
                </p>
              </div>
            </div>
          }
        />
      </div>

      <div className="flex items-center justify-end border-t bg-muted/20 px-4 py-4 sm:px-5">
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Total Amount
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {currency.format(
              lineItems.reduce((acc, item) => acc + item.totalPrice, 0),
            )}
          </p>
        </div>
      </div>

      <AddLineItemModal
        open={modalOpen}
        handleOpenChange={setModalOpen}
        onSave={handleSave}
      />
    </div>
  );
}
