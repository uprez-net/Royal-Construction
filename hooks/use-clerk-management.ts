"use client";
import { useState, useEffect } from "react";
import { fetchJson } from "@/utils/fetch";
import type { User, Invitation } from "@clerk/nextjs/server";

export function useClerkManagement(initialQuery = "", initialPage = 1) {
    const [query, setQuery] = useState(initialQuery);
    const [userPage, setUserPage] = useState(initialPage);
    const [invitePage, setInvitePage] = useState(initialPage);
    const [userTotal, setUserTotal] = useState(0);
    const [inviteTotal, setInviteTotal] = useState(0);
    const [users, setUsers] = useState<User[]>([]);
    const [invites, setInvites] = useState<Invitation[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSendInvite = async (email: string, role: string) => {
        try {
            const res = await fetchJson<{ success: boolean; message: string, invitation: Invitation }>("/api/users", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email, role }),
            }, "Failed to send invite");
            if (res.data.success) {
                console.log("Invite sent successfully");
                setInvites((prev) => [...prev, res.data.invitation]);
                return;
            } else {
                throw new Error(res.data.message || "Failed to send invite");
            }
        } catch (err) {
            console.error("Failed to send invite", err);
            throw err;
        }
    }

    const handleRevokeInvite = async (invitationId: string) => {
        try {
            const res = await fetchJson<{ success: boolean; message: string }>("/api/invitations", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ invitationId }),
            }, "Failed to revoke invite");
            if (res.data.success) {
                console.log("Invite revoked successfully");
                setInvites((prev) => prev.map((invite) =>
                    invite.id === invitationId
                        ? ({ ...invite, status: "revoked" } as unknown as Invitation)
                        : invite
                ));
                return;
            } else {
                throw new Error(res.data.message || "Failed to revoke invite");
            }
        } catch (err) {
            console.error("Failed to revoke invite", err);
            throw err;
        }
    }

    const handleUpdateUserRole = async (userId: string, newRole: string) => {
        try {
            const res = await fetchJson<{ success: boolean; message: string, user: User }>("/api/users", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ userId, newRole }),
            }, "Failed to update user role");
            if (res.data.success) {
                console.log("User role updated successfully");
                setUsers((prev) => prev.map((user) => user.id === userId ? res.data.user : user));
                return;
            } else {
                throw new Error(res.data.message || "Failed to update user role");
            }
        } catch (err) {
            console.error("Failed to update user role", err);
            throw err;
        }
    }

    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            setError(null);

            const q = encodeURIComponent(query.trim());
            fetchJson<{ users: User[]; invites: Invitation[], userTotal: number, inviteTotal: number }>(
                `/api/users?search=${q}&limit=50`,
                { method: "GET" },
                "Failed to fetch users and invites",
                controller.signal
            )
                .then((res) => {
                    const { users, invites, userTotal, inviteTotal } = res.data;
                    setUsers(Array.isArray(users) ? users : []);
                    setInvites(Array.isArray(invites) ? invites : []);
                    setUserTotal(userTotal);
                    setInviteTotal(inviteTotal);
                })
                .catch((err) => {
                    if (err.name === "AbortError") return;
                    console.error("useClerkManagement error", err);
                    setError(String(err?.message ?? "Unknown error"));
                    setUsers([]);
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
    }, [query, userPage, invitePage]);

    return {
        loading,
        error,
        users,
        invites,
        userPage, invitePage,
        userCount: users.length,
        inviteCount: invites.length,
        userTotal,
        inviteTotal,
        setQuery,
        setUserPage,
        setInvitePage,
        handleSendInvite,
        handleUpdateUserRole,
        handleRevokeInvite,
    } as const;
}