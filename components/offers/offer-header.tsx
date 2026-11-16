"use client";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { Plus } from "lucide-react";

export function OfferHeader() {
  const dispatch = useAppDispatch();

  return (
    <PageHeader
      headingLevel="h1"
      title="Offer Management"
      description="Manage your offers, track their status, and ensure timely follow-ups."
      actions={
        <Button
          variant="royal"
          onClick={() => dispatch(openModal({ type: "createOfferFile" }))}
        >
          <Plus className="mr-2 size-4" />
          Create Offer-Document
        </Button>
      }
    />
  );
}
