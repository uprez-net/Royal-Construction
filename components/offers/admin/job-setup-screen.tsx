"use client";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  buildScopeChanged,
  saveBuildScope,
} from "@/lib/store/slices/adminOfferContentSlice";
import { OfferCardHeading } from "@/components/offers/new-workflow/offer-workspace-card-heading";
import { ClipboardList } from "lucide-react";
import { TextBlockListEditor } from "./shared/text-block-list-editor";
import { SaveChangesButton } from "./shared/save-changes-button";

export function JobSetupScreen() {
  const dispatch = useAppDispatch();
  const buildScope = useAppSelector((s) => s.adminOfferContent.data.buildScope);
  const dirty = useAppSelector((s) => s.adminOfferContent.dirty.buildScope);
  const saving = useAppSelector((s) => s.adminOfferContent.saving.buildScope);
  const error = useAppSelector((s) => s.adminOfferContent.error.buildScope);

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <OfferCardHeading
          description="Default scope-of-works lines pre-filled onto every new offer. One line per row."
          icon={<ClipboardList className="size-4" aria-hidden="true" />}
          title="Build scope"
        />
      </CardHeader>
      <CardContent className="pt-4">
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Scope lines
          </span>
          <TextBlockListEditor
            value={buildScope}
            onChange={(lines) => dispatch(buildScopeChanged(lines))}
            ariaLabel="Build scope lines"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <SaveChangesButton
          dirty={dirty}
          saving={saving}
          onSave={() => dispatch(saveBuildScope()).unwrap()}
          successMessage="Build scope saved."
        />
      </CardFooter>
    </Card>
  );
}
