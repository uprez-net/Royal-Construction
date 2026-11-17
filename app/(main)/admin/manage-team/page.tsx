"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import {
  ListToolbar,
  TableCard,
  ToolbarSearch,
  VIEW_TABS_LIST_CLASS,
  VIEW_TABS_TRIGGER_CLASS,
} from "@/components/common/list-toolbar";
import { Role } from "@prisma/client";
import {
  useMemo,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { Check, Loader2, Mail, Pencil, Users, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClerkManagement } from "@/hooks/use-clerk-management";
import { toast } from "sonner";
import type { User, Invitation } from "@clerk/nextjs/server";
import { DataTable } from "@/components/common/data-table";
import { ResultStatus } from "@/components/common/result-status";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { dateFormat, RoleLabelRecord } from "@/utils/formatters";
import { formatAuPhone } from "@/utils/phone";

export default function TeamManagementPage() {
  const [emailAddress, setEmailAddress] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role | undefined>(undefined);
  const [tab, setTab] = useState<"invite" | "members">("members");
  const [isPending, startTransition] = useTransition();
  const {
    loading,
    error,
    users,
    phones,
    invites,
    userCount,
    userTotal,
    inviteCount,
    inviteTotal,
    userPage,
    invitePage,
    setQuery,
    setUserPage,
    setInvitePage,
    handleSendInvite,
    handleUpdateUserRole,
    handleUpdateUserProfile,
    handleRevokeInvite,
  } = useClerkManagement();

  const onSubmit = async () => {
    startTransition(async () => {
      if (!emailAddress || !selectedRole) {
        return;
      }
      const toastId = toast.loading("Sending invitation...");
      try {
        await handleSendInvite(emailAddress, selectedRole);
        toast.success("Invitation sent successfully", { id: toastId });
      } catch (err) {
        console.error("Failed to send invite", err);
        toast.error(
          err instanceof Error ? err.message : "Failed to send invite",
          { id: toastId },
        );
      } finally {
        setEmailAddress("");
        toast.dismiss(toastId);
      }
    });
  };

  if (error) {
    return (
      <div className="container space-y-6 py-4 sm:py-10">
        <PageHeader
          headingLevel="h1"
          title="Team"
          description="Who can sign in to the shared office login, and invitations still waiting."
        />
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center">
            <X className="size-5 text-destructive-ink" />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Failed to load team data
            </p>
            <p className="text-xs text-muted-foreground">
              There was an error loading your team information. Please try again
              later.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container space-y-6 py-4 sm:py-10">
      <PageHeader
        headingLevel="h1"
        title="Team"
        description="Who can sign in to the shared office login, and invitations still waiting."
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          // The search box is keyed by tab and empties on switch; clear the
          // query with it, or the other list stays filtered by a hidden term.
          setQuery("");
          setTab(value as "invite" | "members");
        }}
        className="w-full gap-0"
      >
        <ListToolbar
          start={
            <TabsList
              aria-label="Team"
              variant="line"
              className={VIEW_TABS_LIST_CLASS}
            >
              <TabsTrigger value="members" className={VIEW_TABS_TRIGGER_CLASS}>
                Members
              </TabsTrigger>
              <TabsTrigger value="invite" className={VIEW_TABS_TRIGGER_CLASS}>
                Invitations
              </TabsTrigger>
            </TabsList>
          }
        >
          {/* One search for whichever list is showing. Keyed by tab, so the
              box empties on a switch as the per-tab input did. */}
          <ToolbarSearch
            key={tab}
            aria-label={
              tab === "invite" ? "Search invitations" : "Search members"
            }
            placeholder={
              tab === "invite" ? "Search invitations..." : "Search members..."
            }
            onChange={(e) => setQuery(e.target.value)}
          />
        </ListToolbar>

        <TabsContent value="members" className="pt-5">
          <UserList
            items={users}
            phones={phones}
            isLoaded={loading === false}
            page={userPage}
            count={userCount}
            total={userTotal}
            onPageChange={setUserPage}
            handleAction={(arg) =>
              handleUpdateUserRole(arg.userId, arg.newRole)
            }
            onSaveProfile={handleUpdateUserProfile}
            header={
              <form
                className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_11.25rem_auto] md:items-center"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSubmit();
                }}
              >
                <h2 className="sr-only">Invite someone</h2>
                <Input
                  type="email"
                  placeholder="Email address"
                  aria-label="Invitation email address"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  className="min-h-11 min-w-0 md:min-h-0"
                  name="email"
                  required
                />
                <SelectRole
                  fieldName={"role"}
                  onValueChange={setSelectedRole}
                  selectedRole={selectedRole}
                />
                <Button
                  type="submit"
                  disabled={isPending}
                  className="min-h-11 w-full md:min-h-0 md:w-auto"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Invite
                </Button>
              </form>
            }
          />
        </TabsContent>

        <TabsContent value="invite" className="pt-5">
          <InviteList
            items={invites}
            isLoaded={loading === false}
            page={invitePage}
            count={inviteCount}
            total={inviteTotal}
            onPageChange={setInvitePage}
            handleAction={(arg) => handleRevokeInvite(arg.invitationId)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function memberName(user: User) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}

/**
 * The member's phone: the stored one first, then the copy in Clerk's
 * `publicMetadata.phone` for a member the database has no row for yet.
 */
function memberPhone(user: User, phones: Record<string, string>) {
  const fromMetadata = (user.publicMetadata as { phone?: unknown } | undefined)
    ?.phone;
  return (
    phones[user.id] || (typeof fromMetadata === "string" ? fromMetadata : "")
  );
}

/** A table cell that turns its row into an editor when clicked. */
function EditableCell({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={label}
      title="Click to edit"
      className="group inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md text-left transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-0"
    >
      {children}
      <Pencil
        className="size-3 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
        aria-hidden="true"
      />
    </button>
  );
}

function SelectRole({
  fieldName,
  onValueChange,
  selectedRole,
}: {
  fieldName: string;
  onValueChange: (value: Role | undefined) => void;
  selectedRole: Role | undefined;
}) {
  const options = [
    { label: "Admin", value: Role.ADMIN },
    { label: "Site Manager", value: Role.SITE_MANAGER },
  ];

  return (
    <Select
      value={selectedRole}
      onValueChange={(val) => onValueChange(val as Role | undefined)}
      name={fieldName}
    >
      <SelectTrigger aria-label="Member role" className="w-full sm:w-45">
        <SelectValue placeholder="Select role" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ListTabProps<T, K> {
  items: T[];
  isLoaded: boolean;
  page: number;
  count: number;
  total: number;
  onPageChange: (newPage: number) => void;
  handleAction: (arg: K) => Promise<void>;
}

function UserList({
  items,
  isLoaded,
  page,
  total,
  count,
  onPageChange,
  handleAction,
  phones,
  onSaveProfile,
  header,
}: ListTabProps<User, { userId: string; newRole: Role }> & {
  phones: Record<string, string>;
  onSaveProfile: (
    userId: string,
    profile: { name: string; phone: string },
  ) => Promise<void>;
  /** The invite row, drawn as the first part of the members card. */
  header?: ReactNode;
}) {
  // One row at a time is edited in place. Name and phone only: the email is
  // the sign-in identity, so changing it is Clerk's verification flow, not a
  // table cell.
  const [draft, setDraft] = useState<{
    userId: string;
    name: string;
    phone: string;
    error: string | null;
  } | null>(null);
  const [isSaving, startSaving] = useTransition();

  const startEditing = (user: User) => {
    if (isSaving) return;
    setDraft({
      error: null,
      name: memberName(user),
      phone: formatAuPhone(memberPhone(user, phones)),
      userId: user.id,
    });
  };

  const cancelEditing = () => {
    if (!isSaving) setDraft(null);
  };

  const saveDraft = () => {
    if (!draft || isSaving) return;
    const { userId, name, phone } = draft;
    startSaving(async () => {
      try {
        await onSaveProfile(userId, { name, phone });
        toast.success("Team member updated");
        setDraft(null);
      } catch (err) {
        const error =
          err instanceof Error ? err.message : "Failed to update team member";
        setDraft((current) =>
          current?.userId === userId ? { ...current, error } : current,
        );
      }
    });
  };

  const onDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  };
  const paginationItems = useMemo(() => {
    if (!isLoaded || total === 0 || count === 0) return [1];
    const totalPages = Math.ceil(total / count);

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [page, total, count, isLoaded]);

  return (
    <>
      <TableCard header={header}>
        <div className="p-4 sm:p-5 md:p-0">
          <DataTable
            mobileLayout="cards"
            mobileColumns={1}
            flush
            loading={!isLoaded}
            loadingLabel="Loading team members"
            headers={["Name", "Email", "Phone", "Role"]}
            rows={
              isLoaded
                ? items.map((user) => {
                    const name = memberName(user);
                    const phone = memberPhone(user, phones);
                    const email =
                      user.emailAddresses[0]?.emailAddress || "No email";
                    // One column for the role: the picker shows it and changes it.
                    const roleCell = (
                      <SelectRole
                        key={`role-${user.id}`}
                        fieldName={"role"}
                        onValueChange={(newRole) =>
                          newRole && handleAction({ userId: user.id, newRole })
                        }
                        selectedRole={
                          (user.publicMetadata?.role as Role) || undefined
                        }
                      />
                    );

                    if (draft?.userId === user.id) {
                      const errorId = `member-${user.id}-error`;
                      return [
                        <Input
                          key={`name-${user.id}`}
                          aria-label="Name"
                          autoFocus
                          autoComplete="off"
                          value={draft.name}
                          disabled={isSaving}
                          onChange={(e) =>
                            setDraft({ ...draft, name: e.target.value })
                          }
                          onKeyDown={onDraftKeyDown}
                          className="h-8 min-w-40"
                        />,
                        email,
                        <div key={`phone-${user.id}`} className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
                            <Input
                              aria-label="Phone"
                              aria-invalid={Boolean(draft.error)}
                              aria-describedby={
                                draft.error ? errorId : undefined
                              }
                              type="tel"
                              autoComplete="off"
                              placeholder="0412 345 678"
                              value={draft.phone}
                              disabled={isSaving}
                              onChange={(e) =>
                                setDraft({ ...draft, phone: e.target.value })
                              }
                              // Tidy what was typed into the AU form on the way
                              // out of the field; an unrecognised number is left
                              // as is for the server to explain.
                              onBlur={() =>
                                setDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        phone: formatAuPhone(current.phone),
                                      }
                                    : current,
                                )
                              }
                              onKeyDown={onDraftKeyDown}
                              className="h-8 min-w-0 flex-1 font-mono tabular-nums sm:min-w-36"
                            />
                            <Button
                              type="button"
                              size="icon"
                              className="size-8"
                              onClick={saveDraft}
                              disabled={isSaving}
                              aria-label={`Save ${name || "team member"}`}
                            >
                              {isSaving ? (
                                <Loader2
                                  className="size-4 animate-spin motion-reduce:animate-none"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Check className="size-4" aria-hidden="true" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8"
                              onClick={cancelEditing}
                              disabled={isSaving}
                              aria-label="Cancel editing"
                            >
                              <X className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                          {draft.error ? (
                            <p
                              id={errorId}
                              role="alert"
                              className="max-w-72 text-xs text-destructive"
                            >
                              {draft.error}
                            </p>
                          ) : null}
                        </div>,
                        roleCell,
                      ];
                    }

                    const editLabel = `Edit ${name || "this member"}'s name and phone`;
                    return [
                      <EditableCell
                        key={`name-${user.id}`}
                        label={editLabel}
                        onEdit={() => startEditing(user)}
                      >
                        {name || (
                          <span className="text-muted-foreground">No name</span>
                        )}
                      </EditableCell>,
                      email,
                      <EditableCell
                        key={`phone-${user.id}`}
                        label={editLabel}
                        onEdit={() => startEditing(user)}
                      >
                        {phone ? (
                          <span className="font-mono tabular-nums">
                            {formatAuPhone(phone)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Add phone
                          </span>
                        )}
                      </EditableCell>,
                      roleCell,
                    ];
                  })
                : []
            }
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <Users className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No members found
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your team members will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </div>
      </TableCard>
      {/* Pagination sits below the card, as on Leads. */}
      <div className="space-y-3 pt-2">
        <ResultStatus
          count={isLoaded ? total : null}
          shown={count}
          noun="member"
          hideWhenEmpty
          className="text-center text-xs text-muted-foreground"
        />
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onPageChange(Math.max(1, page - 1));
                }}
                aria-disabled={page === 1}
              />
            </PaginationItem>
            {paginationItems.map((item, index) =>
              item === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink
                    href="#"
                    isActive={item === page}
                    onClick={(event) => {
                      event.preventDefault();
                      onPageChange(item);
                    }}
                  >
                    {item}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onPageChange(Math.min(Math.ceil(total / count), page + 1));
                }}
                aria-disabled={page >= Math.ceil(total / count)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </>
  );
}

function InviteList({
  items,
  isLoaded,
  page,
  total,
  count,
  onPageChange,
  handleAction,
}: ListTabProps<Invitation, { invitationId: string }>) {
  const paginationItems = useMemo(() => {
    if (!isLoaded || total === 0 || count === 0) return [1];
    const totalPages = Math.ceil(total / count);

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) items.push("ellipsis");
    for (let page = start; page <= end; page += 1) items.push(page);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [page, total, count, isLoaded]);

  return (
    <>
      <TableCard>
        <div className="p-4 sm:p-5 md:p-0">
          <DataTable
            mobileLayout="cards"
            mobileColumns={1}
            flush
            loading={!isLoaded}
            loadingLabel="Loading invitations"
            headers={["Email", "Role", "Sent At", "Status", "Actions"]}
            rows={
              isLoaded
                ? items.map((invite) => [
                    invite.emailAddress,
                    invite.publicMetadata?.role
                      ? RoleLabelRecord[invite.publicMetadata?.role as Role]
                      : "No role",
                    dateFormat.format(new Date(invite.createdAt)),
                    invite.status.charAt(0).toUpperCase()
                      + invite.status.slice(1).toLowerCase(),
                    <div
                      className="flex space-x-2"
                      key={`actions-${invite.id}`}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive/50 text-destructive-ink hover:bg-destructive-light hover:text-destructive-ink disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent"
                        onClick={() =>
                          handleAction({ invitationId: invite.id })
                        }
                        disabled={invite.status !== "pending"}
                      >
                        <X className="mr-1 h-4 w-4" />
                        Revoke
                      </Button>
                    </div>,
                  ])
                : []
            }
            emptyState={
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="flex size-12 items-center justify-center">
                  <Users className="size-5 text-muted-foreground" />
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    No invitations found
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Your invitations will appear here.
                  </p>
                </div>
              </div>
            }
          />
        </div>
      </TableCard>
      {/* Pagination sits below the card, as on Leads. */}
      <div className="space-y-3 pt-2">
        <ResultStatus
          count={isLoaded ? total : null}
          shown={count}
          noun="invitation"
          hideWhenEmpty
          className="text-center text-xs text-muted-foreground"
        />
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onPageChange(Math.max(1, page - 1));
                }}
                aria-disabled={page === 1}
              />
            </PaginationItem>
            {paginationItems.map((item, index) =>
              item === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink
                    href="#"
                    isActive={item === page}
                    onClick={(event) => {
                      event.preventDefault();
                      onPageChange(item);
                    }}
                  >
                    {item}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onPageChange(Math.min(Math.ceil(total / count), page + 1));
                }}
                aria-disabled={page >= Math.ceil(total / count)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </>
  );
}
