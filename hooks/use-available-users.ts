import { useState, useEffect } from "react";

export function useAvailableUsers() {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/fetchallusers")
      .then((res) => res.json())
      .then((data) => {
        if (data.users) setUsers(data.users);
      })
      .catch((err) => console.error("Failed to load users for assignment", err));
  }, []);

  return users;
}