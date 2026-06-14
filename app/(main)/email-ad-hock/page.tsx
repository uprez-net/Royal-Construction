"use client";

import React from 'react';
import { Check, Send, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GeneratingModal } from '@/components/Email-adhock/generating-modal';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import ComposeStep from '@/components/Email-adhock/compose-step';
import PreviewStep from '@/components/Email-adhock/preview-step';
import SendStep from '@/components/Email-adhock/send-step';
import { useEmailAdHock } from '@/hooks/use-email-ad-hock';
import { EMAIL_TEMPLATES, STEPS, CampaignLead } from '@/types/email-ad-hock';

// ─── Send Confirmation Modal ────────────────────────────────────

function SendCampaignModal({ isOpen, onClose, onSend, selectedLeads, isSending }: {
  isOpen: boolean; onClose: () => void; onSend: () => void;
  selectedLeads: Map<number, CampaignLead>; isSending: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex flex-col gap-6 rounded-2xl border border-[#E2E8F0] bg-white p-8 shadow-2xl sm:max-w-md w-full mx-4">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="h-5 w-5" />
        </button>
        <h3 className="text-xl font-semibold text-slate-900">Confirm Email Campaign</h3>
        <div className="flex flex-col gap-2 text-sm text-slate-600">
          <p>You are about to send this email to <span className="font-bold text-[#C6923A]">{selectedLeads.size} leads</span>.</p>
          <div className="mt-2 max-h-40 overflow-y-auto border rounded-md bg-slate-50 p-3 divide-y divide-slate-100">
            {Array.from(selectedLeads.values()).map((lead) => (
              <div key={lead.id} className="flex items-center justify-between py-1.5 text-xs">
                <span className="font-medium text-slate-900">{lead.name}</span>
                <span className="text-slate-500">{lead.email}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSending}>Cancel</Button>
          <Button className="bg-[#C6923A] text-white hover:bg-[#C6923A]/90" onClick={onSend} disabled={isSending}>
            {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {isSending ? 'Sending...' : 'Confirm Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function AdHocEmailPage() {
  const hook = useEmailAdHock();

  return (
    <div className="min-h-screen bg-[#F7F6F2] p-6 sm:p-8">
      {hook.isGenerating && <GeneratingModal />}

      <SendCampaignModal
        isOpen={hook.showConfirmModal}
        onClose={() => hook.setShowConfirmModal(false)}
        onSend={hook.handleSendCampaign}
        selectedLeads={hook.selectedLeads}
        isSending={hook.isSending}
      />

      <div className="mx-auto max-w-7xl">
        {/* ── Progress Stepper ── */}
        <div className="mb-10">
          <nav aria-label="Progress" className="mx-auto max-w-xl">
            <ol className="flex items-center">
              {STEPS.map((step, index) => (
                <li key={step.name} className="relative flex-1 flex flex-col items-center">
                  {index < STEPS.length - 1 && (
                    <div className={cn(
                      "absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-[18px] h-0.5 -translate-y-1/2",
                      hook.currentStep > step.id ? "bg-[#C6923A]" : "bg-slate-200"
                    )} aria-hidden="true" />
                  )}
                  <div className={cn(
                    "relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    hook.currentStep === step.id ? "border-[#C6923A] bg-[#C6923A] text-white"
                    : hook.currentStep > step.id ? "border-[#C6923A] bg-[#C6923A] text-white"
                    : "border-slate-300 bg-white text-slate-400"
                  )}>
                    {hook.currentStep > step.id
                      ? <Check className="h-5 w-5" aria-hidden="true" />
                      : <span className="text-sm font-semibold">{step.id}</span>}
                  </div>
                  <div className="mt-2 text-center">
                    <span className={cn(
                      "text-xs font-semibold uppercase tracking-wider",
                      hook.currentStep >= step.id ? "text-[#C6923A]" : "text-slate-400"
                    )}>{step.name}</span>
                  </div>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        {/* ── Step 1: Compose ── */}
        {hook.currentStep === 1 && (
          <ComposeStep
            description={hook.description}
            setDescription={hook.setDescription}
            links={hook.links}
            attachments={hook.attachments}
            errors={hook.errors}
            setErrors={hook.setErrors}
            isGenerating={hook.isGenerating}
            addLink={hook.addLink}
            updateLink={hook.updateLink}
            removeLink={hook.removeLink}
            addAttachment={hook.addAttachment}
            updateAttachment={hook.updateAttachment}
            removeAttachment={hook.removeAttachment}
            handleAttachmentUpload={hook.handleAttachmentUpload}
            handleGenerate={hook.handleGenerate}
            savedTemplates={hook.savedTemplates}
            isLoadingTemplates={hook.isLoadingTemplates}
            handleSelectSavedTemplate={hook.handleSelectSavedTemplate}
            handleDeleteTemplate={hook.openDeleteDialog}
            handleTemplateSelect={hook.handleTemplateSelect}
            emailTemplateId={hook.emailTemplateId}
            EMAIL_TEMPLATES={EMAIL_TEMPLATES}
          />
        )}

        {/* ── Step 2: Preview ── */}
        {hook.currentStep === 2 && (
          <PreviewStep
            templateSection={hook.templateSection}
            emailTemplateId={hook.emailTemplateId}
            templateName={hook.templateName}
            setTemplateName={hook.setTemplateName}
            emailSubject={hook.emailSubject}
            setEmailSubject={hook.setEmailSubject}
            generatedHtml={hook.generatedHtml}
            iframeRef={hook.iframeRef}
            // isSaving={hook.isSaving}
            handleNextToSend={hook.handleNextToSend}
            setCurrentStep={hook.setCurrentStep}
            setEmailTemplateId={hook.setEmailTemplateId}
            setTemplateSection={hook.setTemplateSection}
          />
        )}

        {/* ── Step 3: Send ── */}
        {hook.currentStep === 3 && (
          <SendStep
            searchQuery={hook.searchQuery}
            setSearchQuery={hook.setSearchQuery}
            stageFilter={hook.stageFilter}
            setStageFilter={hook.setStageFilter}
            setCurrentPage={hook.setCurrentPage}
            isSelectAll={hook.isSelectAll}
            handleSelectAll={hook.handleSelectAll}
            totalLeads={hook.totalLeads}
            selectedLeads={hook.selectedLeads}
            isLoadingLeads={hook.isLoadingLeads}
            leadsList={hook.leadsList}
            handleSelectLead={hook.handleSelectLead}
            currentPage={hook.currentPage}
            pageCount={hook.pageCount}
            setCurrentStep={hook.setCurrentStep}
            setShowConfirmModal={hook.setShowConfirmModal}
            templateSection={hook.templateSection}
            emailTemplateId={hook.emailTemplateId}
            saveTemplate={hook.saveTemplate}
            setSaveTemplate={hook.setSaveTemplate}
          />
        )}

        {/* ── Delete Confirmation ── */}
        <AlertDialog open={hook.isConfirmDeleteOpen} onOpenChange={hook.setIsConfirmDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Template</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this template? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={hook.confirmDeleteTemplate}
                className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              >Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
