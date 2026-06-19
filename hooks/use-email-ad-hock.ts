"use client";

import { useEffect, useRef, useState } from 'react';
import {
      CreateEmailAdHock, generateEmailTemplate,
      GetEmailAdHock, DeleteEmailAdHock, getAllLeadIdsForCampaign,
      getLeadsForCampaign,
      RemoveUrlFromBlob,
      sendCampaignEmail,
} from '@/lib/data/email-ad-hock';
import { upload } from '@vercel/blob/client';
import { toast } from 'sonner';
import { updateLead } from '@/lib/leads/leads-service';
import { LinkItem, AttachmentItem, EmailTemplate, FormErrors, generateId, EmailAdHocTemplate, CampaignLead } from '@/types/email-ad-hock';
import { handleTemplateHtmlSend } from "@/components/Email-adhock/handle-template-select";

export function useEmailAdHock() {
      // ─── Navigation ───────────────────────────────────────────────
      const [currentStep, setCurrentStep] = useState(1);
      const iframeRef = useRef<HTMLIFrameElement>(null);

      // ─── Form (Step 1) ───────────────────────────────────────────
      const [description, setDescription] = useState('');
      const [links, setLinks] = useState<LinkItem[]>([]);
      const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
      const [isGenerating, setIsGenerating] = useState(false);
      const [errors, setErrors] = useState<FormErrors>({});
      const [templateSection, setTemplateSection] = useState<
            'default-react-email' | 'saved-templates' | 'ai-generated'
      >('ai-generated');

      // ─── Preview (Step 2) ────────────────────────────────────────
      const [generatedHtml, setGeneratedHtml] = useState('');
      const [emailSubject, setEmailSubject] = useState('');
      const [templateName, setTemplateName] = useState('');
      const [emailTemplateId, setEmailTemplateId] = useState<string | null>(null);
      //const [isSaving, setIsSaving] = useState(false);

      // ─── Saved Templates ─────────────────────────────────────────
      const [savedTemplates, setSavedTemplates] = useState<EmailAdHocTemplate[]>([]);
      const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
      const [templateToDelete, setTemplateToDelete] = useState<EmailAdHocTemplate | null>(null);
      const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

      // ─── Send (Step 3) ───────────────────────────────────────────
      const [leadsList, setLeadsList] = useState<CampaignLead[]>([]);
      const [totalLeads, setTotalLeads] = useState(0);
      const [pageCount, setPageCount] = useState(0);
      const [currentPage, setCurrentPage] = useState(1);
      const [searchQuery, setSearchQuery] = useState('');
      const [stageFilter, setStageFilter] = useState('all');
      const [selectedLeads, setSelectedLeads] = useState<Map<number, CampaignLead>>(new Map());
      const [isSelectAll, setIsSelectAll] = useState(false);
      const [isLoadingLeads, setIsLoadingLeads] = useState(false);
      const [showConfirmModal, setShowConfirmModal] = useState(false);
      const [isSending, setIsSending] = useState(false);

      const [saveTemplate, setSaveTemplate] = useState(false);

      // ─── Effects ─────────────────────────────────────────────────

      useEffect(() => {
            const load = async () => {
                  setIsLoadingTemplates(true);
                  try {
                        const res = await GetEmailAdHock();
                        if (res.success && res.data) setSavedTemplates(res.data);
                  } catch (error) {
                        console.error('Error fetching templates:', error);
                  } finally {
                        setIsLoadingTemplates(false);
                  }
            };
            load();
      }, []);

      useEffect(() => {
            if (currentStep !== 3) return;
            const load = async () => {
                  setIsLoadingLeads(true);
                  try {
                        const result = await getLeadsForCampaign({
                              page: currentPage, limit: 15, search: searchQuery, stage: stageFilter,
                        });
                        setLeadsList(result.leads);
                        setTotalLeads(result.total);
                        setPageCount(result.pageCount);
                        if (result.leads.length === 0) {
                              setIsSelectAll(false);
                        } else {
                              setIsSelectAll(result.leads.every((l: CampaignLead) => selectedLeads.has(l.id)));
                        }
                  } catch (error) {
                        console.error("Failed to fetch leads", error);
                  } finally {
                        setIsLoadingLeads(false);
                  }
            };
            load();
            // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [currentStep, currentPage, searchQuery, stageFilter]);

      // ─── Helper: refresh saved templates ─────────────────────────

      const refreshTemplates = async () => {
            const res = await GetEmailAdHock();
            if (res.success && res.data) setSavedTemplates(res.data);
      };

      // ─── Link Handlers ───────────────────────────────────────────

      const addLink = () =>
            setLinks(prev => [...prev, { id: generateId(), label: '', url: '' }]);

      const updateLink = (id: string, field: keyof LinkItem, value: string) =>
            setLinks(prev => prev.map(l => (l.id === id ? { ...l, [field]: value } : l)));

      const removeLink = (id: string) =>
            setLinks(prev => prev.filter(l => l.id !== id));

      // ─── Attachment Handlers ─────────────────────────────────────

      const addAttachment = () =>
            setAttachments(prev => [...prev, { id: generateId(), label: '', url: '', mode: 'upload', isUploading: false }]);

      const updateAttachment = (id: string, field: keyof AttachmentItem, value: string | boolean) =>
            setAttachments(prev => prev.map(a => (a.id === id ? { ...a, [field]: value } : a)));

      const removeAttachment = async (id: string) => {
            const attachment = attachments.find(a => a.id === id);

            if (attachment?.mode === 'upload' && attachment.url) {
                  try {
                        const remove = await RemoveUrlFromBlob(attachment.url);
                        if (remove.success) {
                              toast.success('Uploaded file removed successfully!');
                        }
                  } catch (error) {
                        console.error('Failed to remove uploaded file:', error);
                        toast.error('Failed to remove uploaded file. Please try again.');
                  }
            }

            setAttachments(prev => prev.filter(a => a.id !== id));
      }


      const handleAttachmentUpload = async (id: string, file: File) => {
            // Set uploading state
            setAttachments(prev => prev.map(a => (a.id === id ? { ...a, isUploading: true, url: '' } : a)));

            try {
                  const blob = await upload(
                        `email-ad-hock-attachment-upload/attachments/${file.name}`,
                        file,
                        {
                              access: 'public',
                              handleUploadUrl: '/api/upload',
                              clientPayload: JSON.stringify({ fileName: file.name, fileSize: file.size, uploadType: 'email-attachment' }),
                        }
                  );

                  // Update attachment with the returned blob URL
                  setAttachments(prev => prev.map(a => (a.id === id ? { ...a, isUploading: false, url: blob.url } : a)));
                  toast.success('File uploaded successfully!');
            } catch (error) {
                  console.error('Upload failed:', error);
                  toast.error('Failed to upload file.');
                  setAttachments(prev => prev.map(a => (a.id === id ? { ...a, isUploading: false } : a)));
            }
      };

      // ─── Validation ──────────────────────────────────────────────

      const validateForm = (): boolean => {
            const e: FormErrors = {};
            if (!description.trim()) e.description = "Description is required";

            links.forEach(link => {
                  const lErr = !link.label.trim() ? "Label is required" : undefined;
                  const uErr = !link.url.trim() ? "URL is required" : undefined;
                  if (lErr || uErr) {
                        if (!e.links) e.links = {};
                        e.links[link.id] = { label: lErr, url: uErr };
                  }
            });

            attachments.forEach(file => {
                  const lErr = !file.label.trim() ? "Name is required" : undefined;
                  const uErr = !file.url.trim() ? "URL is required" : undefined;
                  if (lErr || uErr) {
                        if (!e.attachments) e.attachments = {};
                        e.attachments[file.id] = { label: lErr, url: uErr };
                  }
            });

            setErrors(e);
            return Object.keys(e).length === 0;
      };

      // ─── Generate Email ──────────────────────────────────────────

      const handleGenerate = async () => {
            if (!validateForm()) return;
            setIsGenerating(true);
            try {
                  const result = await generateEmailTemplate(description, attachments, links);
                  setGeneratedHtml(result.html);
                  setEmailSubject(result.subject);
                  setTemplateName(result.name);
                  setCurrentStep(2);
                  setErrors({});
            } catch (error) {
                  console.error('Error generating email:', error);
            } finally {
                  setIsGenerating(false);
            }
      };

      // ─── Saved Template Actions ──────────────────────────────────

      // const handleSelectSavedTemplate = async (template: EmailAdHocTemplate) => {
      //       const t = toast.loading('Loading saved template...');
      //       try {
      //             const res = await fetch(template.htmlUrl);
      //             if (!res.ok) throw new Error('Failed to fetch template content');
      //             const html = await res.text();
      //             setEmailTemplateId(template.id);
      //             setTemplateName(template.name);
      //             setEmailSubject(template.emailSubject);
      //             setGeneratedHtml(html);
      //             setCurrentStep(2);
      //             toast.success('Template loaded!', { id: t });
      //       } catch (error) {
      //             console.error('Error loading template:', error);
      //             toast.error('Failed to load template content.', { id: t });
      //       }
      // };

      const confirmDeleteTemplate = async () => {
            if (!templateToDelete) return;
            const t = toast.loading('Deleting template...');
            try {
                  const res = await DeleteEmailAdHock(templateToDelete.id);
                  if (res.success) {
                        toast.success('Template deleted successfully!', { id: t });
                        if (emailTemplateId === templateToDelete.id) {
                              setEmailTemplateId(null);
                              setTemplateName('');
                              setEmailSubject('');
                              setGeneratedHtml('');
                              setCurrentStep(1);
                        }
                        setTemplateToDelete(null);
                        setIsConfirmDeleteOpen(false);
                        await refreshTemplates();
                  } else {
                        toast.error(res.error || 'Failed to delete template.', { id: t });
                  }
            } catch (error) {
                  console.error('Error deleting template:', error);
                  toast.error('Failed to delete template. Please try again.', { id: t });
            }
      };

      const openDeleteDialog = (template: EmailAdHocTemplate) => {
            setTemplateToDelete(template);
            setIsConfirmDeleteOpen(true);
      };

      // ─── Default Template Selection ──────────────────────────────

      const handleTemplateSelect = async (template: EmailTemplate) => {
            const category = template.category as EmailTemplate['category'];
            const html = await handleTemplateHtmlSend(category);
            setEmailSubject(template.subject);
            setGeneratedHtml(html);
            setTemplateSection('default-react-email');
            setCurrentStep(2);
      };

      // ─── Preview → Send ─────────────────────────────────────────

      const handleNextToSend = async () => {
            const doc = iframeRef.current?.contentDocument;
            if (!doc || !doc.body) {
                  setCurrentStep(3);
                  return;
            }

            // Clean up DOM artifacts from interactive preview
            doc.querySelectorAll('.rc-hover-toolbar').forEach(t => t.remove());
            doc.querySelectorAll('a, button').forEach(el => {
                  (el as HTMLElement).style.outline = '';
                  (el as HTMLElement).style.outlineOffset = '';
            });
            doc.body.contentEditable = 'false';

            let cleanHtml = doc.body.innerHTML;
            cleanHtml = cleanHtml.replace(/\s*contenteditable="[^"]*"/gi, '');
            cleanHtml = cleanHtml.replace(/\s*spellcheck="[^"]*"/gi, '');
            cleanHtml = cleanHtml.replace(/<style[\s\S]*?<\/style>/gi, '');
            cleanHtml = cleanHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
            cleanHtml = cleanHtml.replace(/outline:\s*2px dashed #c6923a;?\s*/gi, '');
            cleanHtml = cleanHtml.replace(/outline-offset:\s*2px;?\s*/gi, '');
            cleanHtml = cleanHtml.replace(/outline:\s*none;?\s*/gi, '');

            // Just save the clean HTML in state and move to Step 3
            setGeneratedHtml(cleanHtml);
            setCurrentStep(3);
      };

      // ─── Saved Template Load (Ensure section is marked) ──────────
      const handleSelectSavedTemplate = async (template: EmailAdHocTemplate) => {
            //const t = toast.loading('Loading saved template...');
            try {
                  const res = await fetch(template.htmlUrl);
                  if (!res.ok) throw new Error('Failed to fetch template content');
                  const html = await res.text();
                  setEmailTemplateId(template.id);
                  setTemplateName(template.name);
                  setEmailSubject(template.emailSubject);
                  setGeneratedHtml(html);
                  setTemplateSection('saved-templates'); // Mark as saved template
                  setCurrentStep(2);
                  //toast.success('Template loaded!', { id: t });
            } catch (error) {
                  console.error('Error loading template:', error);
                  //toast.error('Failed to load template content.', { id: t });
            }
      };

      // ─── Step 3: Send Campaign (With Conditional Save) ───────────
      const handleSendCampaign = async () => {
            setIsSending(true);

            // 1. Save to Wishlist if requested (Only for AI generated new templates)
            if (saveTemplate && templateSection === 'ai-generated' && !emailTemplateId) {
                  const uploadToast = toast.loading('Saving template to wishlist...');
                  try {
                        const sanitized = (templateName || 'custom-template').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
                        const file = new File([generatedHtml], 'index.html', { type: 'text/html' });

                        const blob = await upload(
                              `email-ad-hock/${sanitized}/index.html`, file,
                              {
                                    access: 'public',
                                    handleUploadUrl: '/api/upload',
                                    clientPayload: JSON.stringify({ fileName: 'index.html', fileSize: file.size, uploadType: 'email-template' }),
                              }
                        );

                        const saved = await CreateEmailAdHock(templateName, emailSubject, blob.url);
                        if (saved.success && saved.data) {
                              setEmailTemplateId(saved.data?.id || null);
                              setSavedTemplates(prev => [...prev, saved.data]); // Update local state instantly
                              toast.success('Template saved successfully!', { id: uploadToast });
                        } else {
                              toast.error('Failed to save template in database.', { id: uploadToast });
                        }
                  } catch (error) {
                        console.error('Failed to upload email template:', error);
                        toast.error('Failed to upload template to blob storage.', { id: uploadToast });
                  }
            }

            // 2. Proceed with sending emails
            const leads = Array.from(selectedLeads.values());
            const sendToast = toast.loading(`Sending emails to ${leads.length} leads...`);
            let successCount = 0;
            let failCount = 0;

            try {
                  for (const lead of leads) {
                        if (!lead.email) { failCount++; continue; }
                        try {
                              const personalize = (text: string) =>
                                    text
                                          .replace(/\{id\}/gi, lead.id.toString())
                                          .replace(/\{name\}/gi, lead.name || '')
                                          .replace(/\{email\}/gi, lead.email || '')
                                          .replace(/\{stage\}/gi, lead.stage || '')
                                          .replace(/\{source\}/gi, lead.sourceDetail || lead.source || '')
                                          .replace(/\{projectType\}/gi, (lead.type && lead.type.length > 0) ? lead.type[0] : '')
                                          .replace(/\{location\}/gi, lead.location || '')
                                          .replace(/\{budget\}/gi, lead.budget ? `AU$${lead.budget}` : '')
                                          .replace(/\{assignedUser\}/gi, lead.assignedUser?.name || '')
                                          .replace(/\{followup\}/gi, lead.followupDate ? new Date(lead.followupDate).toLocaleDateString() : '')
                                          .replace(/\{notes\}/gi, lead.notes || '');

                              const personalizedSubject = personalize(emailSubject);
                              const personalizedHtml = personalize(generatedHtml);

                              const sent = await sendCampaignEmail(lead.email, personalizedSubject, personalizedHtml);
                              if (sent) {
                                    successCount++;
                                    const now = new Date();
                                    await updateLead(lead.id, {
                                          history: [{
                                                date: now.toISOString().slice(0, 10),
                                                time: now.toTimeString().slice(0, 5),
                                                action: "Email sent",
                                                detail: `Subject: ${emailSubject}`,
                                                type: "email" as const,
                                          }],
                                    });
                              } else {
                                    failCount++;
                              }
                        } catch (err) {
                              console.error(`Failed to send to ${lead.email}:`, err);
                              failCount++;
                        }
                  }

                  if (successCount > 0 && failCount === 0) {
                        toast.success(`Campaign sent successfully to ${successCount} leads!`, { id: sendToast });
                        setCurrentStep(1);
                        setSelectedLeads(new Map());
                        setIsSelectAll(false);
                        setEmailTemplateId(null);
                        setAttachments([]);
                        setLinks([]);
                        setDescription('');
                        setTemplateSection('ai-generated');
                        setSaveTemplate(false); // Reset checkbox
                  } else if (successCount > 0 && failCount > 0) {
                        toast.warning(`Sent to ${successCount} leads, ${failCount} failed.`, { id: sendToast });
                        setCurrentStep(1);
                        setSelectedLeads(new Map());
                        setIsSelectAll(false);
                        setEmailTemplateId(null);
                        setAttachments([]);
                        setLinks([]);
                        setDescription('');
                        setTemplateSection('ai-generated');
                        setSaveTemplate(false); // Reset checkbox
                  } else {
                        toast.error(`Campaign failed. ${failCount} emails could not be sent.`, { id: sendToast });
                        setEmailTemplateId(null);
                        setAttachments([]);
                        setLinks([]);
                        setDescription('');
                        setTemplateSection('ai-generated');
                        setSaveTemplate(false); // Reset checkbox
                  }
            } catch (error) {
                  console.error('Campaign send error:', error);
                  toast.error('An unexpected error occurred while sending the campaign.', { id: sendToast });
            } finally {
                  setIsSending(false);
                  setShowConfirmModal(false);
            }
      };

      // ─── Lead Selection ──────────────────────────────────────────

      const handleSelectLead = (lead: CampaignLead) => {
            const newMap = new Map(selectedLeads);
            if (newMap.has(lead.id)) newMap.delete(lead.id);
            else newMap.set(lead.id, lead);
            setSelectedLeads(newMap);

            // Use newMap for immediate isSelectAll check
            if (leadsList.length === 0) {
                  setIsSelectAll(false);
            } else {
                  setIsSelectAll(leadsList.every((l) => newMap.has(l.id)));
            }
      };

      const handleSelectAll = async (checked: boolean) => {
            setIsSelectAll(checked);
            const newMap = new Map(selectedLeads);
            const allMatching = await getAllLeadIdsForCampaign({ search: searchQuery, stage: stageFilter });
            if (checked) {
                  allMatching.forEach((lead: CampaignLead) => newMap.set(lead.id, lead));
            } else {
                  allMatching.forEach((lead: CampaignLead) => newMap.delete(lead.id));
            }
            setSelectedLeads(newMap);
      };

      // ─── Send Campaign ───────────────────────────────────────────

      // const handleSendCampaign = async () => {
      //       setIsSending(true);
      //       const leads = Array.from(selectedLeads.values());
      //       const sendToast = toast.loading(`Sending emails to ${leads.length} leads...`);
      //       let successCount = 0;
      //       let failCount = 0;

      //       try {
      //             for (const lead of leads) {
      //                   if (!lead.email) { failCount++; continue; }
      //                   try {
      //                         const personalize = (text: string) =>
      //                               text
      //                                     .replace(/\{id\}/gi, lead.id.toString())
      //                                     .replace(/\{name\}/gi, lead.name || '')
      //                                     .replace(/\{email\}/gi, lead.email || '')
      //                                     .replace(/\{stage\}/gi, lead.stage || '')
      //                                     .replace(/\{source\}/gi, lead.sourceDetail || lead.source || '')
      //                                     .replace(/\{projectType\}/gi, (lead.type && lead.type.length > 0) ? lead.type[0] : '')
      //                                     .replace(/\{location\}/gi, lead.location || '')
      //                                     .replace(/\{budget\}/gi, lead.budget ? `AU$${lead.budget}` : '')
      //                                     .replace(/\{assignedUser\}/gi, lead.assignedUser?.name || '')
      //                                     .replace(/\{followup\}/gi, lead.followupDate ? new Date(lead.followupDate).toLocaleDateString() : '')
      //                                     .replace(/\{notes\}/gi, lead.notes || '');

      //                         const personalizedSubject = personalize(emailSubject);
      //                         const personalizedHtml = personalize(generatedHtml);

      //                         const sent = await sendEmailToLead(lead.email, personalizedSubject, personalizedHtml);
      //                         if (sent) {
      //                               successCount++;
      //                               const now = new Date();
      //                               await updateLead(lead.id, {
      //                                     history: [{
      //                                           date: now.toISOString().slice(0, 10),
      //                                           time: now.toTimeString().slice(0, 5),
      //                                           action: "Email sent",
      //                                           detail: `Subject: ${emailSubject}`,
      //                                           type: "email" as const,
      //                                     }],
      //                               });
      //                         } else {
      //                               failCount++;
      //                         }
      //                   } catch (err) {
      //                         console.error(`Failed to send to ${lead.email}:`, err);
      //                         failCount++;
      //                   }
      //             }

      //             if (successCount > 0 && failCount === 0) {
      //                   toast.success(`Campaign sent successfully to ${successCount} leads!`, { id: sendToast });
      //                   setCurrentStep(1);
      //                   setSelectedLeads(new Map());
      //                   setIsSelectAll(false);
      //                   setEmailTemplateId(null);
      //                   setAttachments([]);
      //                   setLinks([]);
      //                   setDescription('');
      //                   setTemplateSection('ai-generated');
      //             } else if (successCount > 0 && failCount > 0) {
      //                   toast.warning(`Sent to ${successCount} leads, ${failCount} failed.`, { id: sendToast });
      //                   setCurrentStep(1);
      //                   setSelectedLeads(new Map());
      //                   setIsSelectAll(false);
      //                   setEmailTemplateId(null);
      //                   setAttachments([]);
      //                   setLinks([]);
      //                   setDescription('');
      //                   setTemplateSection('ai-generated');
      //             } else {
      //                   toast.error(`Campaign failed. ${failCount} emails could not be sent.`, { id: sendToast });
      //                   setEmailTemplateId(null);
      //                   setAttachments([]);
      //                   setLinks([]);
      //                   setDescription('');
      //                   setTemplateSection('ai-generated');
      //             }
      //       } catch (error) {
      //             console.error('Campaign send error:', error);
      //             toast.error('An unexpected error occurred while sending the campaign.', { id: sendToast });
      //       } finally {
      //             setIsSending(false);
      //             setShowConfirmModal(false);
      //       }
      // };

      // ─── Return ──────────────────────────────────────────────────

      return {
            // Navigation
            currentStep, setCurrentStep,
            // Step 1 — Compose
            description, setDescription, links, attachments, errors, setErrors,
            isGenerating, addLink, updateLink, removeLink,
            addAttachment, updateAttachment, removeAttachment, handleAttachmentUpload, handleGenerate,
            templateSection,
            // Templates
            setTemplateSection, setEmailTemplateId,
            savedTemplates, isLoadingTemplates, handleSelectSavedTemplate,saveTemplate, setSaveTemplate,
            openDeleteDialog, handleTemplateSelect, emailTemplateId,
            // Step 2 — Preview
            templateName, setTemplateName, emailSubject, setEmailSubject,
            generatedHtml, iframeRef, handleNextToSend,
            // Step 3 — Send
            searchQuery, setSearchQuery, stageFilter, setStageFilter,
            currentPage, setCurrentPage, leadsList, totalLeads, pageCount,
            selectedLeads, isSelectAll, isLoadingLeads,
            handleSelectLead, handleSelectAll,
            showConfirmModal, setShowConfirmModal, isSending, handleSendCampaign,
            // Delete dialog
            isConfirmDeleteOpen, setIsConfirmDeleteOpen, confirmDeleteTemplate,
      };
}

