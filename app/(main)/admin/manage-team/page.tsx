"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { skeletonTableRows } from "@/components/ui/skeleton";
import { formatAuPhone } from "@/utils/phone";

export default function TeamManagementPage() {
  const [emailAddress, setEmailAddress] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role | undefined>(undefined);
  const [isPending, startTransition] = useTransition();
  const {
    loading,
    error,
    users,
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
      <div className="container py-10">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="flex size-12 items-center justify-center">
            <X className="size-5 text-red-600" />
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
    <div className="container py-10">
      <Card className="mb-8 w-full">
        <CardHeader>
          <CardTitle>Invite Members</CardTitle>
          <CardDescription>
            Send invitations to new organization members
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex w-full items-center space-x-2"
            onSubmit={onSubmit}
          >
            <Input
              type="email"
              placeholder="Email address"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              className="flex-1"
              name="email"
              required
            />
            <SelectRole
              fieldName={"role"}
              onValueChange={setSelectedRole}
              selectedRole={selectedRole}
            />
            <Button type="submit" disabled={isPending}>
              <Mail className="mr-2 h-4 w-4" />
              Invite
            </Button>
          </form>

          <Tabs defaultValue="invite" className="w-full">
            <TabsList className="mb-4 mt-3">
              <TabsTrigger value="invite">Invitations</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
            </TabsList>

            <TabsContent value="invite">
              <InviteList
                items={invites}
                isLoaded={loading === false}
                page={invitePage}
                count={inviteCount}
                total={inviteTotal}
                setQuery={setQuery}
                onPageChange={setInvitePage}
                handleAction={(arg) => handleRevokeInvite(arg.invitationId)}
              />
            </TabsContent>

            <TabsContent value="members">
              <UserList
                items={users}
                isLoaded={loading === false}
                page={userPage}
                count={userCount}
                total={userTotal}
                setQuery={setQuery}
                onPageChange={setUserPage}
                handleAction={(arg) =>
                  handleUpdateUserRole(arg.userId, arg.newRole)
                }
                onSaveProfile={handleUpdateUserProfile}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function memberName(user: User) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ");
}

/** Clerk's primary number, from the serialized user the list holds. */
function memberPhone(user: User) {
  return (
    user.phoneNumbers.find((phone) => phone.id === user.primaryPhoneNumberId)
      ?.phoneNumber
    ?? user.phoneNumbers[0]?.phoneNumber
    ?? ""
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
      className="group inline-flex items-center gap-1.5 rounded-md text-left transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
      <SelectTrigger className="w-45">
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
  setQuery: (q: string) => void;
  onPageChange: (newPage: number) => void;
  handleAction: (arg: K) => Promise<void>;
}

function UserList({
  items,
  isLoaded,
  page,
  total,
  count,
  setQuery,
  onPageChange,
  handleAction,
  onSaveProfile,
}: ListTabProps<User, { userId: string; newRole: Role }> & {
  onSaveProfile: (
    userId: string,
    profile: { name: string; phone: string },
  ) => Promise<void>;
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
      phone: formatAuPhone(memberPhone(user)),
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
    <div className="w-full px-4 space-y-4">
      <div className="flex items-center space-x-2">
        {/* Search Bar */}
        <Input
          type="text"
          placeholder="Search members..."
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
      </div>
      {/* Data Table  */}
      <DataTable
        headers={["Name", "Email", "Phone", "Role", "Actions"]}
        rows={
          isLoaded
            ? items.map((user) => {
                const name = memberName(user);
                const phone = memberPhone(user);
                const email =
                  user.emailAddresses[0]?.emailAddress || "No email";
                const role = user.publicMetadata?.role
                  ? RoleLabelRecord[user.publicMetadata?.role as Role]
                  : "No role";

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
                      <Input
                        aria-label="Phone"
                        aria-invalid={Boolean(draft.error)}
                        aria-describedby={draft.error ? errorId : undefined}
                        type="tel"
                        autoComplete="off"
                        placeholder="0412 345 678"
                        value={draft.phone}
                        disabled={isSaving}
                        onChange={(e) =>
                          setDraft({ ...draft, phone: e.target.value })
                        }
                        // Tidy what was typed into the AU form on the way out
                        // of the field; an unrecognised number is left as is
                        // for the server to explain.
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
                        className="h-8 min-w-36 font-mono tabular-nums"
                      />
                      {draft.error ? (
                        <p
                          id={errorId}
                          role="alert"
                          className="max-w-64 text-xs text-destructive"
                        >
                          {draft.error}
                        </p>
                      ) : null}
                    </div>,
                    role,
                    <div className="flex space-x-2" key={`actions-${user.id}`}>
                      <Button
                        type="button"
                        size="sm"
                        onClick={saveDraft}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <Loader2
                            className="mr-1 size-4 animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                        ) : (
                          <Check className="mr-1 size-4" aria-hidden="true" />
                        )}
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={cancelEditing}
                        disabled={isSaving}
                      >
                        <X className="mr-1 size-4" aria-hidden="true" />
                        Cancel
                      </Button>
                    </div>,
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
                      <span className="text-muted-foreground">Add phone</span>
                    )}
                  </EditableCell>,
                  role,
                  <div className="flex space-x-2" key={`actions-${user.id}`}>
                    <SelectRole
                      fieldName={"role"}
                      onValueChange={(newRole) =>
                        newRole && handleAction({ userId: user.id, newRole })
                      }
                      selectedRole={
                        (user.publicMetadata?.role as Role) || undefined
                      }
                    />
                  </div>,
                ];
              })
            : skeletonTableRows(5)
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
      {/* Pagination Controls (implement as needed) */}
      <div className="space-y-3 pt-2">
        <div className="text-center text-xs text-muted-foreground">
          Showing {count} of {total} members
        </div>
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
    </div>
  );
}

function InviteList({
  items,
  isLoaded,
  page,
  total,
  count,
  setQuery,
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
    <div className="w-full px-4 space-y-4">
      <div className="flex items-center space-x-2">
        {/* Search Bar */}
        <Input
          type="text"
          placeholder="Search invitations..."
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
      </div>
      {/* Data Table  */}
      <DataTable
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
                <div className="flex space-x-2" key={`actions-${invite.id}`}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 border-red-600 hover:bg-red-600 hover:text-white disabled:border-red-300 disabled:text-red-300 disabled:hover:bg-transparent"
                    onClick={() => handleAction({ invitationId: invite.id })}
                    disabled={invite.status !== "pending"}
                  >
                    <X className="mr-1 h-4 w-4" />
                    Revoke
                  </Button>
                </div>,
              ])
            : skeletonTableRows(5)
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
      {/* Pagination Controls (implement as needed) */}
      <div className="space-y-3 pt-2">
        <div className="text-center text-xs text-muted-foreground">
          Showing {count} of {total} invitations
        </div>
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
    </div>
  );
}
