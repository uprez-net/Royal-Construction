"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { FileText, Paperclip, Tags, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { filePreviewModal } from "@/utils/file-preview";

export type AgentAnnotation = {
  type: string;
  id: string;
  label: string;
  href: string;
  group: string;
};

type AgentComposerContextProps = {
  annotations: AgentAnnotation[];
  setAnnotations: Dispatch<SetStateAction<AgentAnnotation[]>>;
  annotationResults: AgentAnnotation[];
  annotationQuery: string;
  selectAnnotation: (annotation: AgentAnnotation) => void;
  attachments: File[];
  setAttachments: Dispatch<SetStateAction<File[]>>;
};

export function AgentComposerContext({
  annotations,
  setAnnotations,
  annotationResults,
  annotationQuery,
  selectAnnotation,
  attachments,
  setAttachments,
}: AgentComposerContextProps) {
  const dispatch = useAppDispatch();
  const objectUrls = useRef(new Map<File, string>());
  const [open, setOpen] = useState(false);
  const hasContext =
    annotations.length > 0 ||
    attachments.length > 0 ||
    (annotationQuery.length >= 2 && annotationResults.length > 0);

  useEffect(
    () => () => {
      for (const url of objectUrls.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  function previewAttachment(file: File) {
    const url = objectUrls.current.get(file) ?? URL.createObjectURL(file);
    objectUrls.current.set(file, url);
    const action = filePreviewModal(
      [{ url, name: file.name, fileType: file.type }],
      0,
    );
    if (action) {
      if (action.type === "previewFile") {
        dispatch(
          openModal({
            ...action,
            payload: {
              ...action.payload,
              fileName: file.name,
              fileType: file.type,
            },
          }),
        );
      } else {
        dispatch(openModal(action));
      }
    }
  }

  if (!hasContext) return null;

  return (
    <div className="pointer-events-none absolute bottom-11 left-3 z-10">
      <Popover open={open && hasContext} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            className="pointer-events-auto rounded-full bg-background/95 shadow-sm backdrop-blur"
            size="sm"
            type="button"
            variant="outline"
          >
            {attachments.length > 0 ? (
              <Paperclip data-icon="inline-start" />
            ) : (
              <Tags data-icon="inline-start" />
            )}
            {attachments.length + annotations.length}{" "}
            {attachments.length + annotations.length === 1 ? "item" : "items"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] p-2"
          side="top"
        >
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {annotations.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {annotations.map((annotation) => (
                  <Badge
                    key={`${annotation.type}:${annotation.id}`}
                    variant="secondary"
                  >
                    {annotation.label}
                    <button
                      aria-label={`Remove ${annotation.label}`}
                      className="ml-1"
                      onClick={() =>
                        setAnnotations((items) =>
                          items.filter((item) => item.id !== annotation.id),
                        )
                      }
                      type="button"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
            {annotationQuery.length >= 2 && annotationResults.length > 0 ? (
              <div className="flex flex-col gap-1 border-t pt-2">
                {annotationResults.map((annotation) => (
                  <button
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    key={`${annotation.type}:${annotation.id}`}
                    onClick={() => selectAnnotation(annotation)}
                    type="button"
                  >
                    <span>{annotation.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {annotation.group}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {attachments.length > 0 ? (
              <div className="flex flex-col gap-1 border-t pt-2">
                {attachments.map((file) => (
                  <div
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-muted"
                    key={`${file.name}:${file.lastModified}`}
                  >
                    <button
                      className="flex min-w-0 items-center gap-2 text-left text-sm"
                      onClick={() => previewAttachment(file)}
                      title={`Review ${file.name}`}
                      type="button"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{file.name}</span>
                    </button>
                    <button
                      aria-label={`Remove ${file.name}`}
                      className="shrink-0 rounded p-1 hover:bg-background"
                      onClick={() =>
                        setAttachments((items) =>
                          items.filter((item) => item !== file),
                        )
                      }
                      type="button"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
