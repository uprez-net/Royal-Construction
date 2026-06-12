import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Search, Check, ChevronLeft, ChevronRight as ChevronRightIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CampaignLead } from '@/types/email-ad-hock';

const STAGES = ["all", "New", "Contacted", "Meeting Scheduled", "In Follow-up", "Qualified", "Quoted", "Negotiating", "No Response", "Cancelled", "Disqualified", "Lost"];

interface SendStepProps {
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  stageFilter: string;
  setStageFilter: React.Dispatch<React.SetStateAction<string>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  isSelectAll: boolean;
  handleSelectAll: (checked: boolean) => void;
  totalLeads: number;
  selectedLeads: Map<number, CampaignLead>;
  isLoadingLeads: boolean;
  leadsList: CampaignLead[];
  handleSelectLead: (lead: CampaignLead) => void;
  currentPage: number;
  pageCount: number;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  setShowConfirmModal: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function SendStep({
  searchQuery, setSearchQuery, stageFilter, setStageFilter, setCurrentPage,
  isSelectAll, handleSelectAll, totalLeads, selectedLeads, isLoadingLeads,
  leadsList, handleSelectLead, currentPage, pageCount, setCurrentStep,
  setShowConfirmModal,
}: SendStepProps) {
  return (
    <div className="space-y-6">
      {/* Top Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative md:col-span-2 flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search leads by name, email, or location..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            className="pl-9 h-10 bg-white border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]"
          />
        </div>
        <select
          value={stageFilter}
          onChange={(e) => { setStageFilter(e.target.value); setCurrentPage(1); }}
          className="flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C6923A]"
        >
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stage === 'all' ? 'All Stages' : stage}
            </option>
          ))}
        </select>
      </div>

      {/* Select All & Count */}
      <div className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isSelectAll}
            onChange={(e) => handleSelectAll(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#C6923A] focus:ring-[#C6923A]"
          />
          <span className="text-sm font-medium text-slate-700">Select All {totalLeads} Leads</span>
        </label>
        <span className="text-sm font-semibold text-[#C6923A]">
          {selectedLeads.size} selected
        </span>
      </div>

      {/* Lead List - 3 Column Grid */}
      <div className="max-h-[500px] overflow-y-auto">
        {isLoadingLeads ? (
          <div className="flex justify-center items-center py-12 rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : leadsList.length === 0 ? (
          <div className="text-center py-12 text-sm text-slate-500 rounded-lg border border-[#E2E8F0] bg-white shadow-sm">No leads found.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {leadsList.map((lead) => (
              <div
                key={lead.id}
                onClick={() => handleSelectLead(lead)}
                className={cn(
                  "flex items-center gap-4 rounded-lg border bg-white p-4 shadow-sm cursor-pointer transition-all hover:shadow-md hover:bg-slate-50",
                  selectedLeads.has(lead.id)
                    ? "border-[#C6923A] bg-[#C6923A]/5 ring-1 ring-[#C6923A]/30"
                    : "border-[#E2E8F0]"
                )}
              >
                <div className={cn(
                  "h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white",
                  selectedLeads.has(lead.id) ? "bg-[#C6923A]" : "bg-slate-300"
                )}>
                  {selectedLeads.has(lead.id) ? <Check className="h-4 w-4" /> : lead.name?.charAt(0) || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{lead.name || 'Unknown'}</p>
                  <p className="truncate text-xs text-slate-500">{lead.email}</p>
                  <span className={cn(
                    "mt-1.5 inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full",
                    lead.stage === "New" ? "bg-blue-50 text-blue-700" :
                    lead.stage === "Qualified" ? "bg-green-50 text-green-700" :
                    lead.stage === "Meeting Scheduled" ? "bg-purple-50 text-purple-700" :
                    "bg-slate-100 text-slate-600"
                  )}>
                    {lead.stage}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2 pt-2">
        <Button variant="outline" size="sm" disabled={currentPage === 1} className='hover:cursor-pointer hover:opacity-50' onClick={() => setCurrentPage(p => p - 1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
        </Button>

        <div className="flex items-center gap-1">
          {Array.from({ length: pageCount || 1 }, (_, i) => i + 1).map((page) => {
            const totalPages = pageCount || 1;
            const showPage = page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1;
            const showEllipsisBefore = page === currentPage - 2 && currentPage > 3;
            const showEllipsisAfter = page === currentPage + 2 && currentPage < totalPages - 2;

            if (showEllipsisBefore || showEllipsisAfter) return <span key={page} className="px-1 text-sm text-slate-400">…</span>;
            if (!showPage) return null;

            return (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={cn(
                  "h-8 min-w-[2rem] rounded-md px-2 text-sm font-medium transition-colors hover:cursor-pointer hover:opacity-50",
                  currentPage === page ? "bg-[#C6923A] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {page}
              </button>
            );
          })}
        </div>

        <Button variant="outline" size="sm" disabled={currentPage >= pageCount} className="hover:cursor-pointer hover:opacity-50" onClick={() => setCurrentPage(p => p + 1)}>
          Next <ChevronRightIcon className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Footer Actions */}
      <div className="flex justify-between items-center pt-6 border-t border-slate-200">
        <Button variant="outline" onClick={() => setCurrentStep(2)}>Back</Button>
        <Button
          className="bg-[#C6923A] text-white hover:bg-[#C6923A]/90"
          disabled={selectedLeads.size === 0}
          onClick={() => setShowConfirmModal(true)}
        >
          <Mail className="mr-2 h-4 w-4" />
          Send Email ({selectedLeads.size})
        </Button>
      </div>
    </div>
  );
}