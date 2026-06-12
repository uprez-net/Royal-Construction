import { fetchJson } from "@/utils/fetch";
import { useState, useEffect } from "react";

interface ReturnedUser {
  id: string;
  name: string;
  email: string;
}

export function useAvailableUsers() {
  const [users, setUsers] = useState<ReturnedUser[]>([]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetchJson<ReturnedUser[]>("/api/(data)/fetchallusers", {
          method: "GET",
        }, "Failed to fetch users");

        setUsers(response.data);
      } catch (error) {
        console.error("Failed to fetch users", error);
      }
    };

    fetchUsers();
  }, []);

  return users;
}