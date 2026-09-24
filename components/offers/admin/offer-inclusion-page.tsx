import { useId, useMemo } from "react";
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
  inclusionsScheduleChanged,
  inclusionScheduleRowRestored,
  saveOfferContent,
} from "@/lib/store/slices/adminOfferContentSlice";
import { InclusionScheduleEditor } from "./shared/inclusion-schedule-editor";
import { normaliseScheduleRows } from "./shared/inclusion-schedule";
import { FilePenLine } from "lucide-react";

export function OfferInclusionsPage() {
  const dispatch = useAppDispatch();
  const headingId = useId();
  const storedSchedule = useAppSelector(
    (s) => s.adminOfferContent.data.offerContent.inclusionSchedule,
  );
  const inclusionSchedule = useMemo(
    () => normaliseScheduleRows(storedSchedule),
    [storedSchedule],
  );
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.offerContent);
  const saving = useAppSelector((s) => s.adminOfferContent.saving.offerContent);
  const error = useAppSelector((s) => s.adminOfferContent.error.offerContent);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Edit each Offer inclusion, its category and optional Tender Text."
          icon={<FilePenLine className="size-4" aria-hidden="true" />}
          title="Offer document inclusions"
        />
      </CardHeader>
      <CardContent className="grid gap-6 pt-4">
        <div role="group" aria-labelledby={headingId} className="space-y-2">
          <p id={headingId} className="text-sm font-medium leading-snug">
            Inclusion Schedule
          </p>
          <InclusionScheduleEditor
            value={inclusionSchedule}
            onChange={(rows) =>
              dispatch(inclusionsScheduleChanged(normaliseScheduleRows(rows)))
            }
            onRestore={(row, index) =>
              dispatch(inclusionScheduleRowRestored({ row, index }))
            }
          />
        </div>
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
          onSave={() => dispatch(saveOfferContent()).unwrap()}
          successMessage="Inclusion schedule saved."
        />
      </CardFooter>
    </Card>
  );
}
