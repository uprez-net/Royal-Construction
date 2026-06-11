"use client";

import {
  AtSign,
  Bold,
  Italic,
  Link,
  List,
  Save,
  Sparkles,
  Strikethrough,
  Underline,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Plate,
  PlateElement,
  type PlateElementProps,
  useEditorRef,
  usePlateEditor,
} from "platejs/react";
import { KEYS, type Value } from "platejs";
import {
  BasicBlocksPlugin,
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { filterWords } from "@platejs/combobox";
import {
  useComboboxInput,
  useHTMLInputCursorState,
} from "@platejs/combobox/react";
import { toggleList } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import { LinkPlugin } from "@platejs/link/react";
import { MentionInputPlugin, MentionPlugin } from "@platejs/mention/react";

import type { LeadRichTextDocument, LeadRichTextNode } from "@/lib/leads/types";
import {
  createLeadNotesDocument,
  extractMentionedUserIds,
  normalizeRichTextLink,
} from "@/lib/rich-text/lead-notes";
import { Editor, EditorContainer } from "@/components/rich-text/plate-editor";

type MentionableUser = {
  id: string;
  name: string;
  email?: string;
};

type LeadRichTextEditorProps = {
  value: LeadRichTextDocument | null | undefined;
  availableUsers: MentionableUser[];
  onChange: (document: LeadRichTextDocument) => void;
  onSaveNote: () => void;
  canSaveNote: boolean;
  isSavingNote: boolean;
};

type MentionElementNode = LeadRichTextNode & {
  key?: string;
  value?: string;
};

type LinkElementNode = LeadRichTextNode & {
  url?: string;
};

type AiNoteAction = "improve" | "summarize" | "followup";
type PreservedMention = {
  token: string;
  node: MentionElementNode;
};

type FloatingMenuPosition = {
  left: number;
  top: number;
  width: number;
};

const aiNoteActions: Array<{ label: string; value: AiNoteAction }> = [
  { label: "Improve", value: "improve" },
  { label: "Summarize", value: "summarize" },
  { label: "Follow-up", value: "followup" },
];

const MentionUsersContext = createContext<MentionableUser[]>([]);

function isRichTextNode(value: unknown): value is LeadRichTextNode {
  return Boolean(value && typeof value === "object");
}

function createMentionToken(index: number) {
  return `{{MENTION_${index}}}`;
}

function cloneMentionNode(node: MentionElementNode): MentionElementNode {
  return {
    children: [{ text: "" }],
    key: node.key,
    type: "mention",
    value: node.value,
  };
}

function serializeNodeForAi(
  node: LeadRichTextNode,
  preservedMentions: PreservedMention[],
): string {
  if (typeof node.text === "string") return node.text;

  if (node.type === "mention" && typeof node.value === "string") {
    const token = createMentionToken(preservedMentions.length + 1);
    preservedMentions.push({
      token,
      node: cloneMentionNode(node as MentionElementNode),
    });
    return token;
  }

  if (!Array.isArray(node.children)) return "";
  return node.children
    .filter(isRichTextNode)
    .map((child) => serializeNodeForAi(child, preservedMentions))
    .join("");
}

function serializeDocumentForAi(document: LeadRichTextDocument) {
  const preservedMentions: PreservedMention[] = [];
  const text = document.value
    .map((node) => serializeNodeForAi(node, preservedMentions).trim())
    .filter(Boolean)
    .join("\n");

  return {
    preservedMentions,
    text,
  };
}

function textWithMentionsToNodes(
  text: string,
  preservedMentions: PreservedMention[],
): LeadRichTextNode[] {
  const mentionsByToken = new Map(
    preservedMentions.map((mention) => [mention.token, mention.node]),
  );
  const escapedTokens = preservedMentions.map((mention) =>
    mention.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const tokenPattern =
    escapedTokens.length > 0 ? new RegExp(`(${escapedTokens.join("|")})`, "g") : null;
  let restoredText = text.trim();

  for (const mention of preservedMentions) {
    if (!restoredText.includes(mention.token)) {
      restoredText = `${restoredText}${restoredText ? " " : ""}${mention.token}`;
    }
  }

  const paragraphs = restoredText
    ? restoredText.split(/\r?\n(?:\s*\r?\n)*/)
    : [""];

  return paragraphs.map((paragraph) => {
    if (!tokenPattern) {
      return { type: "p", children: [{ text: paragraph }] };
    }

    const children: LeadRichTextNode[] = [];
    const parts = paragraph.split(tokenPattern).filter((part) => part !== "");

    for (const part of parts) {
      const mention = mentionsByToken.get(part);
      if (mention) {
        children.push(cloneMentionNode(mention));
      } else if (part) {
        children.push({ text: part });
      }
    }

    return {
      type: "p",
      children: children.length > 0 ? children : [{ text: "" }],
    };
  });
}

function MentionElement(props: PlateElementProps) {
  const element = props.element as MentionElementNode;

  return (
    <PlateElement
      {...props}
      as="span"
      className="inline-flex rounded bg-[#ccfbf1] px-1.5 py-0.5 text-xs font-medium text-[#115e59]"
      data-mention-key={element.key}
    >
      @{element.value}
      {props.children}
    </PlateElement>
  );
}

function LinkElement(props: PlateElementProps) {
  const element = props.element as LinkElementNode;
  const href = typeof element.url === "string" ? element.url : undefined;

  return (
    <PlateElement
      {...props}
      as="a"
      attributes={{
        ...props.attributes,
        contentEditable: false,
        href,
        rel: "noreferrer",
        target: "_blank",
      }}
      className="font-medium text-[#0D9488] underline decoration-[#5eead4] underline-offset-2"
    >
      {props.children}
    </PlateElement>
  );
}

function MentionInputElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const availableUsers = useContext(MentionUsersContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [search, setSearch] = useState("");
  const [menuPosition, setMenuPosition] =
    useState<FloatingMenuPosition | null>(null);
  const cursorState = useHTMLInputCursorState(inputRef);
  const { props: inputProps } = useComboboxInput({
    autoFocus: true,
    cancelInputOnBlur: true,
    cursorState,
    ref: inputRef,
  });
  const normalizedSearch = search.toLowerCase();
  const filteredUsers = availableUsers
    .filter((user) => {
      if (!normalizedSearch) return true;

      return (
        filterWords(user.name, normalizedSearch) ||
        filterWords(user.email ?? "", normalizedSearch)
      );
    })
    .slice(0, 8);

  useEffect(() => {
    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      setMenuPosition({
        left: rect.left,
        top: rect.bottom + 4,
        width: Math.max(256, rect.width),
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [search]);

  const selectUser = (user: MentionableUser) => {
    editor.tf.replaceNodes(
      {
        children: [{ text: "" }],
        key: user.id,
        type: "mention",
        value: user.name,
      },
      { at: props.path, select: true },
    );
    editor.tf.move({ unit: "offset" });
    editor.tf.insertText(" ");
  };

  const menu =
    menuPosition &&
    createPortal(
      <span
        className="fixed z-[10000] flex max-h-64 flex-col overflow-y-auto rounded-[6px] border border-[#d6d3d1] bg-white py-1 text-left shadow-xl"
        style={{
          left: menuPosition.left,
          top: menuPosition.top,
          width: menuPosition.width,
        }}
      >
        {filteredUsers.length > 0 ? (
          filteredUsers.map((user) => (
            <button
              key={user.id}
              type="button"
              className="flex w-full flex-col px-3 py-2 text-left hover:bg-[#f0fdfa]"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectUser(user);
              }}
            >
              <span className="text-sm font-medium leading-5 text-[#0c0a09]">
                {user.name}
              </span>
              {user.email && (
                <span className="truncate text-xs leading-4 text-[#78716c]">
                  {user.email}
                </span>
              )}
            </button>
          ))
        ) : (
          <span className="px-3 py-2 text-xs text-[#78716c]">
            No users found
          </span>
        )}
      </span>,
      document.body,
    );

  return (
    <PlateElement
      {...props}
      as="span"
      className="relative inline-flex align-baseline"
    >
      <span
        ref={triggerRef}
        contentEditable={false}
        className="relative inline-flex rounded bg-[#f0fdfa] px-1.5 py-0.5 text-xs text-[#0f766e]"
      >
        @
        <span className="relative min-w-2">
          <span className="invisible whitespace-pre" aria-hidden="true">
            {search || "\u200B"}
          </span>
          <input
            ref={inputRef}
            className="absolute inset-0 size-full min-w-2 bg-transparent p-0 text-xs text-[#0f766e] outline-none"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              inputProps.onKeyDown(event);
              if (event.defaultPrevented) return;
              if (event.key === "Enter" && filteredUsers[0]) {
                event.preventDefault();
                selectUser(filteredUsers[0]);
              }
            }}
            onBlur={inputProps.onBlur}
          />
        </span>
      </span>
      {menu}
      {props.children}
    </PlateElement>
  );
}

function ToolbarButton({
  children,
  disabled,
  isActive,
  onClick,
  title,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  isActive?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className={`inline-flex size-8 items-center justify-center rounded-[5px] border text-[#44403c] transition-colors hover:border-[#d6d3d1] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 ${
        isActive
          ? "border-[#99f6e4] bg-[#ccfbf1] text-[#0f766e]"
          : "border-transparent bg-transparent"
      }`}
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function AiActionButton({
  disabled,
  isWorking,
  onClick,
}: {
  disabled?: boolean;
  isWorking: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-transparent bg-[#0D9488] px-3 text-xs font-medium text-white transition-colors hover:bg-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      disabled={disabled}
      title="Run AI rewrite"
    >
      {isWorking ? (
        <div className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
      ) : (
        <Sparkles className="size-3.5" />
      )}
      AI Rewrite
    </button>
  );
}

function EditorToolbar({
  editor,
  onReplaceNoteText,
  value,
}: {
  editor: NonNullable<ReturnType<typeof usePlateEditor>>;
  onReplaceNoteText: (
    text: string,
    preservedMentions: PreservedMention[],
  ) => void;
  value: LeadRichTextDocument | null | undefined;
}) {
  const [aiAction, setAiAction] = useState<AiNoteAction>("improve");
  const [isAiWorking, setIsAiWorking] = useState(false);
  const mentionedUserIds = extractMentionedUserIds(
    value ?? createLeadNotesDocument({ plainText: "" }),
  );
  const isBoldActive = editor.api.mark(BoldPlugin.key) === true;
  const isItalicActive = editor.api.mark(ItalicPlugin.key) === true;
  const isUnderlineActive = editor.api.mark(UnderlinePlugin.key) === true;
  const isStrikeActive = editor.api.mark(StrikethroughPlugin.key) === true;

  const insertLink = () => {
    const href = window.prompt("Enter link URL");
    if (!href) return;

    const safeHref = normalizeRichTextLink(href);
    if (!safeHref) {
      window.alert("Use a valid http, https, mailto, tel, or relative link.");
      return;
    }

    editor.tf.insertNodes({
      type: "a",
      url: safeHref,
      children: [{ text: safeHref }],
    });
  };

  const toggleBullets = () => {
    toggleList(editor, { listStyleType: KEYS.ul });
  };

  const runAiAction = async () => {
    const currentDocument = value ?? createLeadNotesDocument({ plainText: "" });
    const { preservedMentions, text: noteText } =
      serializeDocumentForAi(currentDocument);

    if (!noteText.trim()) {
      window.alert("Write a note before using AI.");
      return;
    }

    setIsAiWorking(true);
    try {
      const response = await fetch("/api/leads/notes/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: aiAction,
          mentionTokens: preservedMentions.map((mention) => ({
            label: mention.node.value,
            token: mention.token,
          })),
          text: noteText,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
        text?: string;
      } | null;

      if (!response.ok || typeof result?.text !== "string") {
        throw new Error(result?.error ?? "Failed to update the note with AI.");
      }

      onReplaceNoteText(result.text, preservedMentions);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Failed to update the note with AI.",
      );
    } finally {
      setIsAiWorking(false);
    }
  };

  return (
    <div className="relative z-20 flex min-h-12 flex-wrap items-center gap-2 border-b border-[#e7e5e4] bg-[#fafaf9] px-3 py-2">
      <div className="flex items-center gap-1 rounded-[6px] border border-[#e7e5e4] bg-white p-1">
        <ToolbarButton
          title="Bold"
          isActive={isBoldActive}
          onClick={() => editor.getTransforms(BoldPlugin).bold.toggle()}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          isActive={isItalicActive}
          onClick={() => editor.getTransforms(ItalicPlugin).italic.toggle()}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Underline"
          isActive={isUnderlineActive}
          onClick={() =>
            editor.getTransforms(UnderlinePlugin).underline.toggle()
          }
        >
          <Underline className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          title="Strikethrough"
          isActive={isStrikeActive}
          onClick={() =>
            editor.getTransforms(StrikethroughPlugin).strikethrough.toggle()
          }
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>
      </div>
      <div className="flex items-center gap-1 rounded-[6px] border border-[#e7e5e4] bg-white p-1">
        <ToolbarButton title="Bulleted list" onClick={toggleBullets}>
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton title="Link" onClick={insertLink}>
          <Link className="size-4" />
        </ToolbarButton>
      </div>
      <div className="flex items-center gap-1 rounded-[6px] border border-[#e7e5e4] bg-white p-1">
        <select
          className="h-8 rounded-[5px] border border-transparent bg-transparent px-2 text-xs font-medium text-[#44403c] outline-none hover:border-[#d6d3d1] disabled:cursor-not-allowed disabled:opacity-50"
          value={aiAction}
          onChange={(event) => setAiAction(event.target.value as AiNoteAction)}
          disabled={isAiWorking}
          title="AI note action"
        >
          {aiNoteActions.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </select>
        <AiActionButton
          isWorking={isAiWorking}
          onClick={runAiAction}
          disabled={isAiWorking}
        />
      </div>
      <div className="ml-auto flex items-center gap-1 rounded-[6px] border border-[#ccfbf1] bg-white px-2 py-1 text-xs text-[#0f766e]">
        <AtSign className="size-3.5" />
        <span>Type @ to mention</span>
        {mentionedUserIds.length > 0 && (
          <span className="ml-1 border-l border-[#ccfbf1] pl-2">
            {mentionedUserIds.length} mention
            {mentionedUserIds.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

export function LeadRichTextEditor({
  value,
  availableUsers,
  onChange,
  onSaveNote,
  canSaveNote,
  isSavingNote,
}: LeadRichTextEditorProps) {
  const initialDocument = useMemo(
    () => value ?? createLeadNotesDocument({ plainText: "" }),
    [value],
  );
  const editor = usePlateEditor(
    {
      plugins: [
        BasicBlocksPlugin,
        BoldPlugin,
        ItalicPlugin,
        UnderlinePlugin,
        StrikethroughPlugin,
        ListPlugin,
        LinkPlugin.configure({
          options: {
            defaultLinkAttributes: {
              rel: "noreferrer",
              target: "_blank",
            },
          },
        }).withComponent(LinkElement),
        MentionPlugin.configure({
          options: {
            insertSpaceAfterMention: true,
            triggerPreviousCharPattern: /^$|^[\s"']$/,
          },
        }).withComponent(MentionElement),
        MentionInputPlugin.withComponent(MentionInputElement),
      ],
      value: initialDocument.value as unknown as Value,
    },
    [],
  );
  const replaceNoteText = (
    text: string,
    preservedMentions: PreservedMention[],
  ) => {
    const nextDocument = createLeadNotesDocument({
      value: textWithMentionsToNodes(text, preservedMentions),
    });
    editor.tf.replaceNodes(nextDocument.value as unknown as Value, {
      at: [],
      children: true,
    });
    onChange(nextDocument);
  };

  return (
    <div className="relative z-10 mt-1 overflow-visible rounded-[6px] border border-[#d6d3d1] bg-white focus-within:border-[#0D9488] focus-within:ring-2 focus-within:ring-[#CCFBF1]">
      <EditorToolbar
        editor={editor}
        onReplaceNoteText={replaceNoteText}
        value={value}
      />
      <Plate
        editor={editor}
        onChange={({ value: nextValue }) => {
          onChange(
            createLeadNotesDocument({
              value: nextValue as LeadRichTextNode[],
            }),
          );
        }}
      >
        <MentionUsersContext.Provider value={availableUsers}>
          <EditorContainer variant="leadNote">
            <Editor
              variant="leadNote"
              placeholder="Write a note. Type @ to mention a team member."
            />
          </EditorContainer>
        </MentionUsersContext.Provider>
      </Plate>

      <div className="flex items-center justify-end border-t border-[#e7e5e4] bg-[#f8fafc] px-3 py-2">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded bg-[#0D9488] px-3 text-xs font-medium text-white hover:bg-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onSaveNote}
          disabled={!canSaveNote || isSavingNote}
        >
          {isSavingNote ? (
            <>
              <div className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Saving...
            </>
          ) : (
            <>
              <Save className="size-3.5" />
              Save Note
            </>
          )}
        </button>
      </div>
    </div>
  );
}
