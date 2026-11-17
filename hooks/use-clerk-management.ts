"use client";
import { useState, useEffect } from "react";
import { useIdempotencyKeys } from "@/hooks/use-idempotency-key";
import { fetchJson } from "@/utils/fetch";
import type { User, Invitation } from "@clerk/nextjs/server";

export function useClerkManagement(initialQuery = "", initialPage = 1) {
  // Both the invite and the revoke reach Clerk, which emails the person. The
  // routes already read an Idempotency-Key and pass it to the domain, which
  // uses it as the OutboxEvent key; nothing was sending one, so the domain
  // fell back to a key that buckets an invite by day and address. Keyed by
  // target so one person's failed invite cannot consume the next person's key.
  const inviteKeys = useIdempotencyKeys();
  const [query, setQuery] = useState(initialQuery);
  const [userPage, setUserPage] = useState(initialPage);
  const [invitePage, setInvitePage] = useState(initialPage);
  const [userTotal, setUserTotal] = useState(0);
  const [inviteTotal, setInviteTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  // Stored phones by Clerk id. The team screen reads these first; Clerk's
  // publicMetadata.phone is only the fallback.
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [invites, setInvites] = useState<Invitation[]>([]);
  // Bumped after an invite, so the lists reload from the server: a search
  // GET started before the POST could otherwise land after it and drop the
  // new invitation.
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendInvite = async (email: string, role: string) => {
    try {
      const res = await fetchJson<{
        success: boolean;
        message: string;
        invitation: Invitation;
      }>(
        "/api/users",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": inviteKeys.current(`invite:${email}`),
          },
          body: JSON.stringify({ email, role }),
        },
        "Failed to send invite",
      );
      if (res.data.success) {
        console.log("Invite sent successfully");
        inviteKeys.rotate(`invite:${email}`);
        setInvites((prev) => [...prev, res.data.invitation]);
        setRefreshKey((key) => key + 1);
        return;
      } else {
        throw new Error(res.data.message || "Failed to send invite");
      }
    } catch (err) {
      console.error("Failed to send invite", err);
      throw err;
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    try {
      const res = await fetchJson<{ success: boolean; message: string }>(
        // Was /api/invitations, which is not a route in this app — the revoke
        // handler is the DELETE on /api/users, so every revoke from the team
        // screen 404d and reported "Failed to revoke invite".
        "/api/users",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": inviteKeys.current(`revoke:${invitationId}`),
          },
          body: JSON.stringify({ invitationId }),
        },
        "Failed to revoke invite",
      );
      if (res.data.success) {
        console.log("Invite revoked successfully");
        inviteKeys.rotate(`revoke:${invitationId}`);
        setInvites((prev) =>
          prev.map((invite) =>
            invite.id === invitationId
              ? ({ ...invite, status: "revoked" } as unknown as Invitation)
              : invite,
          ),
        );
        return;
      } else {
        throw new Error(res.data.message || "Failed to revoke invite");
      }
    } catch (err) {
      console.error("Failed to revoke invite", err);
      throw err;
    }
  };

  const handleUpdateUserRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetchJson<{
        success: boolean;
        message: string;
        user: User;
      }>(
        "/api/users",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId, newRole }),
        },
        "Failed to update user role",
      );
      if (res.data.success) {
        console.log("User role updated successfully");
        setUsers((prev) =>
          prev.map((user) => (user.id === userId ? res.data.user : user)),
        );
        return;
      } else {
        throw new Error(res.data.message || "Failed to update user role");
      }
    } catch (err) {
      console.error("Failed to update user role", err);
      throw err;
    }
  };

  const handleUpdateUserProfile = async (
    userId: string,
    profile: { name: string; phone: string },
  ) => {
    const res = await fetchJson<{
      success: boolean;
      message: string;
      phone: string;
      user: User;
    }>(
      "/api/users/profile",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId, ...profile }),
      },
      "Failed to update team member",
    );
    setUsers((prev) =>
      prev.map((user) => (user.id === userId ? res.data.user : user)),
    );
    setPhones((prev) => ({ ...prev, [userId]: res.data.phone }));
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);

      const q = encodeURIComponent(query.trim());
      fetchJson<{
        users: User[];
        phones?: Record<string, string>;
        invites: Invitation[];
        userTotal: number;
        inviteTotal: number;
      }>(
        `/api/users?search=${q}&limit=50`,
        { method: "GET" },
        "Failed to fetch users and invites",
        controller.signal,
      )
        .then((res) => {
          const { users, phones, invites, userTotal, inviteTotal } = res.data;
          setUsers(Array.isArray(users) ? users : []);
          setPhones(phones ?? {});
          setInvites(Array.isArray(invites) ? invites : []);
          setUserTotal(userTotal);
          setInviteTotal(inviteTotal);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          console.error("useClerkManagement error", err);
          setError(String(err?.message ?? "Unknown error"));
          setUsers([]);
          setPhones({});
          setInvites([]);
          setUserTotal(0);
          setInviteTotal(0);
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, userPage, invitePage, refreshKey]);

  return {
    loading,
    error,
    users,
    phones,
    invites,
    userPage,
    invitePage,
    userCount: users.length,
    inviteCount: invites.length,
    userTotal,
    inviteTotal,
    setQuery,
    setUserPage,
    setInvitePage,
    handleSendInvite,
    handleUpdateUserRole,
    handleUpdateUserProfile,
    handleRevokeInvite,
  } as const;
}
