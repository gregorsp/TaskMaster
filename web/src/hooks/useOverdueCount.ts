import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";

export function useOverdueCount(): number {
  const [count, setCount] = useState(0);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    const fetch = async () => {
      try {
        const { data } = await client.get<{ items: unknown[]; total: number }>("/tasks/overdue");
        setCount(data.total);
      } catch {
        setCount(0);
      }
    };

    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  return count;
}
