import { useEffect, useState, type ChangeEvent } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  hbfcClaimChanged,
  saveHBFCClaim,
} from "@/lib/store/slices/adminOfferContentSlice";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FilePenLine } from "lucide-react";
import { OfferCardHeading } from "../new-workflow/offer-workspace-card-heading";

function useNumericInput(value: number, onCommit: (value: number) => void) {
  const [raw, setRaw] = useState(() =>
    Number.isFinite(value) ? String(value) : "",
  );

  useEffect(() => {
    const parsed = parseFloat(raw);
    const rawIsCurrent = Number.isFinite(value) ? parsed === value : raw === "";
    if (!rawIsCurrent) {
      setTimeout(() => {
        setRaw(Number.isFinite(value) ? String(value) : "");
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (!/^-?\d*\.?\d*$/.test(next)) return;
    setRaw(next);
    onCommit(
      next === "" || next === "-" || next === "." ? NaN : parseFloat(next),
    );
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
  const totalPremiumToBePaid = useAppSelector(
    (s) => s.adminOfferContent.data.hbfcClaim.totalPremiumToBePaid,
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
          title="HBCF Claim Amount"
        />
      </CardHeader>
      <CardContent className="grid gap-6 pt-4">
        <label>
          <FieldLabel>Claim Amount</FieldLabel>
          <NumberField
            value={claimAmount}
            onChange={(claimAmount) =>
              dispatch(hbfcClaimChanged({ claimAmount, loadingChargePercent }))
            }
            placeholder="Enter the system wide HBCF claim amount"
          />
        </label>
        <label>
          <FieldLabel>Loading Charge Percent</FieldLabel>
          <PercentInput
            value={loadingChargePercent}
            onChange={(loadingChargePercent) =>
              dispatch(hbfcClaimChanged({ claimAmount, loadingChargePercent }))
            }
            placeholder="Enter the system wide HBCF loading charge percentage"
          />
        </label>
        <label>
          <FieldLabel>Total Premium</FieldLabel>
          <Input
            value={
              Number.isFinite(totalPremiumToBePaid) ? totalPremiumToBePaid : ""
            }
            disabled
            readOnly
            placeholder="Auto-calculated from claim amount + loading charge"
            className="bg-muted/50 cursor-not-allowed"
          />
        </label>
      </CardContent>
      <CardFooter className="flex items-center justify-end gap-2">
        <Button
          onClick={() => dispatch(saveHBFCClaim())}
          disabled={!dirty || saving}
        >
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardFooter>
    </Card>
  );
}
