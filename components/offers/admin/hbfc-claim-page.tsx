import { useEffect, useState, type ChangeEvent } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  hbfcClaimChanged,
  saveHBFCClaim,
} from "@/lib/store/slices/adminOfferContentSlice";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FilePenLine } from "lucide-react";
import { OfferCardHeading } from "../new-workflow/offer-workspace-card-heading";
import { SaveChangesButton } from "./shared/save-changes-button";
import { isRawCurrent } from "./shared/numeric-input";

function useNumericInput(value: number, onCommit: (value: number) => void) {
  const [raw, setRaw] = useState(() =>
    Number.isFinite(value) ? String(value) : "",
  );

  useEffect(() => {
    if (!isRawCurrent(raw, value)) {
      setTimeout(() => {
        setRaw(Number.isFinite(value) ? String(value) : "");
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    // A claim amount and a loading percentage are never negative.
    if (!/^\d*\.?\d*$/.test(next)) return;
    setRaw(next);
    onCommit(next === "" || next === "." ? NaN : parseFloat(next));
  };

  return { value: raw, onChange };
}

function NumberField({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
}) {
  const field = useNumericInput(value, onChange);
  return <Input {...field} inputMode="decimal" placeholder={placeholder} />;
}

function PercentInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
}) {
  const field = useNumericInput(value, onChange);
  return (
    <div className="relative">
      <Input
        {...field}
        inputMode="decimal"
        placeholder={placeholder}
        className="pr-7"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
        %
      </span>
    </div>
  );
}

export function HBFCClaimPage() {
  const dispatch = useAppDispatch();
  const claimAmount = useAppSelector(
    (s) => s.adminOfferContent.data.hbfcClaim.claimAmount,
  );
  const loadingChargePercent = useAppSelector(
    (s) => s.adminOfferContent.data.hbfcClaim.loadingChargePercent,
  );
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.hbfcClaim);
  const saving = useAppSelector((s) => s.adminOfferContent.saving.hbfcClaim);
  const error = useAppSelector((s) => s.adminOfferContent.error.hbfcClaim);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Edit the system wide HBCF claim amount."
          icon={<FilePenLine className="size-4" aria-hidden="true" />}
          title="HBCF Claim Amount & Loading Charge Percent (For HBCF Premium)"
        />
      </CardHeader>
      <CardContent className="grid gap-6 pt-4">
        <label>
          <FieldLabel>HBCF Claim Amount</FieldLabel>
          <NumberField
            value={claimAmount}
            onChange={(claimAmount) =>
              dispatch(hbfcClaimChanged({ claimAmount, loadingChargePercent }))
            }
            placeholder="Enter the system wide HBCF claim amount"
          />
        </label>
        <label>
          <FieldLabel>Loading Charge Percent (For HBCF Premium)</FieldLabel>
          <PercentInput
            value={loadingChargePercent}
            onChange={(loadingChargePercent) =>
              dispatch(hbfcClaimChanged({ claimAmount, loadingChargePercent }))
            }
            placeholder="Enter the system wide HBCF loading charge percentage"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <SaveChangesButton
          dirty={dirty}
          saving={saving}
          disabled={
            !Number.isFinite(claimAmount) ||
            !Number.isFinite(loadingChargePercent)
          }
          onSave={() => dispatch(saveHBFCClaim()).unwrap()}
          successMessage="HBCF settings saved."
        />
      </CardFooter>
    </Card>
  );
}
