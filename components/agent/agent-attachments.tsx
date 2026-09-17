"use client";

import { useEffect, useRef, useState } from "react";
import { FileImage, FileText, Paperclip, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { filePreviewModal } from "@/utils/file-preview";

type AgentAttachmentsProps = {
  attachments: File[];
  setAttachments: React.Dispatch<React.SetStateAction<File[]>>;
};

const ACCEPTED_FILES = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv";

export function AgentAttachments({ attachments, setAttachments }: AgentAttachmentsProps) {
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Map<File, string>());
  const [open, setOpen] = useState(false);

  useEffect(() => () => {
    for (const url of objectUrls.current.values()) URL.revokeObjectURL(url);
  }, []);

  function addFiles(event: React.ChangeEvent<HTMLInputElement>) {
    setAttachments((items) => [...items, ...Array.from(event.target.files ?? [])].slice(0, 5));
    event.target.value = "";
  }

  function previewAttachment(file: File) {
    const url = objectUrls.current.get(file) ?? URL.createObjectURL(file);
    objectUrls.current.set(file, url);
    const action = filePreviewModal([{ url, name: file.name, fileType: file.type }], 0);
    if (!action) return;
    if (action.type === "previewFile") {
      dispatch(openModal({ ...action, payload: { ...action.payload, fileName: file.name, fileType: file.type } }));
    } else {
      dispatch(openModal(action));
    }
  }

  const picker = (
    <input accept={ACCEPTED_FILES} className="hidden" multiple onChange={addFiles} ref={inputRef} type="file" />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button aria-label={`Manage ${attachments.length} attachments`} className="relative" size="icon-sm" type="button" variant="ghost">
          <Paperclip />
          <Badge className="absolute -top-1 -right-1 size-4 justify-center rounded-full p-0 text-[10px]" variant="secondary">
            {attachments.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2" side="top">
        <div className="flex flex-col gap-2">
          <Button className="w-full justify-start" onClick={() => inputRef.current?.click()} size="sm" type="button" variant="outline">
            <Plus data-icon="inline-start" />
            Add more
          </Button>
          {picker}
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto no-scrollbar">
            {attachments.map((file) => (
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted" key={`${file.name}:${file.lastModified}`}>
                <button aria-label={`Review ${file.name}`} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => previewAttachment(file)} title={`Review ${file.name}`} type="button">
                  {file.type.startsWith("image/") ? <FileImage /> : <FileText />}
                  <span className="truncate">{file.name}</span>
                </button>
                <button aria-label={`Remove ${file.name}`} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => setAttachments((items) => items.filter((item) => item !== file))} type="button">
                  <X />
                </button>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
