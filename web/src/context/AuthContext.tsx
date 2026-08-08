import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import type { User } from "../api/authApi";
import { logout as apiLogout, refresh } from "../api/authApi";
import { onAuthExpired } from "../api/client";
import { listTasks } from "../api/tasksApi";
import { useNotify } from "./NotifyContext";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const notifiedOverdue = useRef(false);
  const notify = useNotify();

  useEffect(() => {
    refresh()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => onAuthExpired(() => setUser(null)), []);

  useEffect(() => {
    if (user && !notifiedOverdue.current) {
      notifiedOverdue.current = true;
      listTasks({ isOverdue: true, pageSize: 1 })
        .then((res) => {
          if (res.total > 0) {
            notify(
              `Du hast ${res.total} überfällige Aufgabe${res.total > 1 ? "n" : ""}`,
              "warning"
            );
          }
        })
        .catch(() => {});
    }
  }, [user]);

  const login = useCallback((user: User) => {
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    notifiedOverdue.current = false;
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
