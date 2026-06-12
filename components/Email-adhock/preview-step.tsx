import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { getEditablePreviewHtml } from '@/lib/utils/email-preview';

interface PreviewStepProps {
  templateSection: string;
  emailTemplateId: string | null;
  templateName: string;
  setTemplateName: React.Dispatch<React.SetStateAction<string>>;
  emailSubject: string;
  setEmailSubject: React.Dispatch<React.SetStateAction<string>>;
  generatedHtml: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  isSaving: boolean;
  handleNextToSend: () => void;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  setEmailTemplateId: React.Dispatch<React.SetStateAction<string | null>>;
  setTemplateSection: React.Dispatch<React.SetStateAction<'default-react-email' | 'saved-templates' | 'ai-generated'>>;
}

export default function PreviewStep({
  templateSection, emailTemplateId, templateName, setTemplateName,
  emailSubject, setEmailSubject, generatedHtml, iframeRef, isSaving,
  handleNextToSend, setCurrentStep, setEmailTemplateId, setTemplateSection,
}: PreviewStepProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templateSection !== 'default-react-email' && (
          <div className="rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Template Name</label>
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              readOnly={emailTemplateId !== null}
              className="text-lg font-semibold border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]"
            />
          </div>
        )}
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Subject</label>
          <Input
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            className="text-lg border-slate-200 focus:border-[#C6923A] focus:ring-[#C6923A]"
          />
        </div>
      </div>

      <div className="rounded-lg border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
        <div className="bg-slate-50 border-b border-[#E2E8F0] px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">Interactive Preview (Click to edit text. Hover links to change URLs)</span>
        </div>
        <div className="w-full bg-[#F7F6F2] p-4 md:p-8 flex justify-center">
          <div className="w-full max-w-[640px] min-h-[600px] bg-white rounded shadow-md overflow-hidden">
            {generatedHtml ? (
              <iframe
                ref={iframeRef}
                srcDoc={getEditablePreviewHtml(generatedHtml)}
                title="Email Preview"
                className="w-full h-[700px] border-none"
                sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin"
              />
            ) : (
              <div className="flex h-[600px] items-center justify-center text-sm text-slate-400">
                No preview generated yet.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-2">
        <Button
          variant="outline"
          onClick={() => {
            setEmailTemplateId(null);
            setTemplateSection('ai-generated');
            setCurrentStep(1);
          }}
          className="border-slate-300"
        >
          Back to Compose
        </Button>
        <Button className="bg-[#C6923A] text-white hover:bg-[#C6923A]/90" onClick={handleNextToSend} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {templateSection === 'default-react-email' ? 'Next & Proceed' : isSaving ? 'Saving...' : 'Next: Saved & Proceed'}
        </Button>
      </div>
    </div>
  );
}