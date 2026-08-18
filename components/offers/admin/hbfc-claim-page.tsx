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

export function HBFCClaimPage() {
  const dispatch = useAppDispatch();
  const claimAmount = useAppSelector(
    (s) => s.adminOfferContent.data.hbfcClaim.claimAmount,
  );
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.hbfcClaim);
  const saving = useAppSelector((s) => s.adminOfferContent.saving.hbfcClaim);
  const error = useAppSelector((s) => s.adminOfferContent.error.hbfcClaim);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Edit the system wide HBFC claim amount."
          icon={<FilePenLine className="size-4" aria-hidden="true" />}
          title="HBFC Claim Amount"
        />
      </CardHeader>
      <CardContent className="grid gap-6 pt-4">
        <label>
          <FieldLabel>Claim Amount</FieldLabel>
          <Input
            value={claimAmount}
            onChange={(e) =>
              dispatch(
                hbfcClaimChanged({ claimAmount: parseFloat(e.target.value) }),
              )
            }
            placeholder="Enter the system wide HBFC claim amount"
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
