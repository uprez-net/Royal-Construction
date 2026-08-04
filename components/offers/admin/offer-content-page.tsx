"use client";

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  inclusionsChanged,
  termsAndConditionsChanged,
  saveOfferContent,
} from "@/lib/store/slices/adminOfferContentSlice";
import { OfferCardHeading } from "@/components/offers/new-workflow/offer-workspace-card-heading";
import { FilePenLine } from "lucide-react";
import { BulletListEditor } from "./shared/bullet-list-editor";
import { SaveChangesButton } from "./shared/save-changes-button";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

export function OfferContentPage() {
  const dispatch = useAppDispatch();
  const inclusions = useAppSelector(
    (s) => s.adminOfferContent.data.offerContent.inclusions,
  );
  const terms = useAppSelector(
    (s) => s.adminOfferContent.data.offerContent.termsAndConditions,
  );
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.offerContent);
  const saving = useAppSelector(
    (s) => s.adminOfferContent.saving.offerContent,
  );
  const error = useAppSelector((s) => s.adminOfferContent.error.offerContent);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Edit the default customer-facing one-pager copy: inclusion bullets and terms & conditions text."
          icon={<FilePenLine className="size-4" aria-hidden="true" />}
          title="Offer document copy"
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
        <label>
          <FieldLabel>Terms &amp; conditions</FieldLabel>
          <Textarea
            value={terms}
            onChange={(e) =>
              dispatch(termsAndConditionsChanged(e.target.value))
            }
            rows={10}
            placeholder="Default terms and conditions…"
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
