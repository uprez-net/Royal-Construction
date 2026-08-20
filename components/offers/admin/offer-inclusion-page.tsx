import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { SaveChangesButton } from "./shared/save-changes-button";
import { OfferCardHeading } from "../new-workflow/offer-workspace-card-heading";
import {
  inclusionsChanged,
  saveOfferContent,
} from "@/lib/store/slices/adminOfferContentSlice";
import { FieldLabel } from "@/components/ui/field";
import { BulletListEditor } from "./shared/bullet-list-editor";
import { FilePenLine } from "lucide-react";

export function OfferInclusionsPage() {
  const dispatch = useAppDispatch();
  const inclusions = useAppSelector(
    (s) => s.adminOfferContent.data.offerContent.inclusions,
  );
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.offerContent);
  const saving = useAppSelector((s) => s.adminOfferContent.saving.offerContent);
  const error = useAppSelector((s) => s.adminOfferContent.error.offerContent);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Define the reusable inclusion bullets pre-filled onto every new construction offer."
          icon={<FilePenLine className="size-4" aria-hidden="true" />}
          title="Offer document inclusions"
        />
      </CardHeader>
      <CardContent className="grid gap-6 pt-4">
        <label>
          <FieldLabel>Inclusion bullets</FieldLabel>
          <BulletListEditor
            value={inclusions}
            onChange={(lines) => dispatch(inclusionsChanged(lines))}
            addLabel="Add bullet"
            placeholder="Inclusion text"
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
          onSave={() => dispatch(saveOfferContent())}
        />
      </CardFooter>
    </Card>
  );
}
