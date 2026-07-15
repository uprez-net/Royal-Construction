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
export function CreateOfferFileModal({
  open,
  onClose,
}: CreateOfferFileModalProps) {
  const router = useRouter();
  const leadSearch = useLeadSearch("");
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

  const handleSubmit = () => {
    if (!selectedLeadId) {
      toast.error("Please select a lead to open its offer workspace.");
      return;
    }
    handleOpenChange(false);
    router.push(`/offers/${selectedLeadId}`);
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

        <div className="mt-4 p-2 flex flex-col gap-6 max-h-[60vh] overflow-y-auto">
          <div className="space-y-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by lead name, email, site address, or build type"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />

            <LeadCardList
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
            />
          </div>
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
            disabled={!selectedLeadId}
            className="h-10 rounded-[10px] bg-royal-gold px-4 text-[12.5px] font-semibold text-primary-foreground hover:bg-royal-gold-dark"
          >
            Open Offer Workspace
            <ArrowRight className="ml-1.5 size-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
