"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLeadSearch } from "@/hooks/useLeadSearch";
import { shownSelection } from "@/lib/leads/lead-search-paging";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LeadCardList } from "./lead-card-list";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface CreateOfferFileModalProps {
  open: boolean;
  onClose: () => void;
}

// Lead picker that opens the offer workspace for the chosen lead. The workspace
// (ADR 0002) self-provisions its Offer row on load, so there is no separate
// "create offer" step — selecting a lead and navigating is the whole flow.
// Only leads without a project are shown (a lead with a project is done).
export function CreateOfferFileModal({
  open,
  onClose,
}: CreateOfferFileModalProps) {
  const router = useRouter();
  const leadSearch = useLeadSearch("", undefined, true);
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);

  const resetSearch = useCallback(() => {
    setSearch("");
    leadSearch.setQuery("");
  }, [leadSearch]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedLeadId(null);
      resetSearch();
      onClose();
    }
  };

  // A search can hide the chosen lead without clearing the choice, and opening
  // it would create an offer for a lead the user can no longer see.
  const chosenLeadId = shownSelection(
    selectedLeadId,
    leadSearch.items,
    leadSearch.loading,
  );

  const handleSubmit = () => {
    if (!chosenLeadId) {
      toast.error("Please select a lead to open its offer workspace.");
      return;
    }
    handleOpenChange(false);
    router.push(`/offers/${chosenLeadId}`);
  };

  useEffect(() => {
    leadSearch.setQuery(search);
  }, [search, leadSearch]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Leads Directory</DialogTitle>
          <DialogDescription>
            Select a lead to open its offer workspace.
          </DialogDescription>
        </DialogHeader>

        {/* No scroller here: the card list is the only scroll area, sized to
            show at least two rows. A second one around it boxed the list into
            a 24vh strip inside a 60vh strip. */}
        <div className="mt-4 flex flex-col gap-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by lead name, email, site address, or build type"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />

          <LeadCardList
            className="max-h-[min(60vh,34rem)]"
            loading={leadSearch.loading}
            items={leadSearch.items}
            selectedLeadId={selectedLeadId}
            setSelectedLeadId={(id) => {
              setSelectedLeadId(id);
            }}
            setPage={leadSearch.setPage}
            currentPage={leadSearch.pageInfo.page}
            totalPages={leadSearch.pageInfo.totalPages}
            loadingMore={leadSearch.loadingMore}
            error={leadSearch.error}
            emptyMessage={
              leadSearch.resultQuery
                ? "No leads match your search."
                : "No leads are ready for an offer."
            }
          />
        </div>
        <DialogFooter className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!chosenLeadId}
            className="h-10 rounded-[10px] bg-royal-gold-ink px-4 text-[12.5px] font-semibold text-white hover:bg-royal-gold-ink-hover"
          >
            Open Offer Workspace
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
