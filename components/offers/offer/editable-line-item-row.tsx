import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currency } from "@/utils/formatters";


export type LineItemUnit = "m" | "m2" | "m3" | "each" | "allowance" | "lump sum";

export const LINE_ITEM_UNIT_LABELS: Record<LineItemUnit, string> = {
  "m": "m",
  "m2": "m²",
  "m3": "m³",
  "each": "Each",
  "allowance": "Allowance",
  "lump sum": "Lump Sum",
};

type NumericProps = {
  type: "numeric";
  isCurrency?: boolean;
  currentValue: number;
  onValueChange: (value: number) => void;
};

type UnitProps = {
  type: "unit";
  currentValue: LineItemUnit;
  onValueChange: (value: LineItemUnit) => void;
};

type EditableLineItemRowProps = NumericProps | UnitProps;

export function EditableLineItemRow(props: EditableLineItemRowProps) {
  if (props.type === "numeric") {
    return <NumericEditor {...props} />;
  }

  return <UnitEditor {...props} />;
}

function NumericEditor({
  currentValue,
  onValueChange,
  isCurrency = false,
}: NumericProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentValue);

  const save = () => {
    onValueChange(value);
    setIsEditing(false);
  };

  const cancel = () => {
    setValue(currentValue);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="group inline-flex items-center gap-3"
      >
        <span>{isCurrency ? currency.format(currentValue) : currentValue}</span>
        <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          setValue(Math.max(0, Number.isNaN(n) ? 0 : n));
        }}
        className="h-8 w-24"
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
      />

      <Button size="icon" variant="ghost" onClick={save}>
        <Check className="size-4 text-green-500" />
      </Button>

      <Button size="icon" variant="ghost" onClick={cancel}>
        <X className="size-4 text-red-500" />
      </Button>
    </div>
  );
}

function UnitEditor({
  currentValue,
  onValueChange,
}: UnitProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState<LineItemUnit>(currentValue);

  const save = () => {
    onValueChange(value);
    setIsEditing(false);
  };

  const cancel = () => {
    setValue(currentValue);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="group inline-flex items-center gap-1"
      >
        <span>{currentValue}</span>
        <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value}
        onValueChange={(v) => setValue(v as LineItemUnit)}
      >
        <SelectTrigger className="h-8 w-36">
          <SelectValue />
        </SelectTrigger>

        <SelectContent>
          {(Object.keys(LINE_ITEM_UNIT_LABELS) as LineItemUnit[]).map((unit) => (
            <SelectItem key={unit} value={unit}>
              {LINE_ITEM_UNIT_LABELS[unit]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="icon" variant="ghost" onClick={save}>
        <Check className="size-4 text-green-500" />
      </Button>

      <Button size="icon" variant="ghost" onClick={cancel}>
        <X className="size-4 text-red-500" />
      </Button>
    </div>
  );
}