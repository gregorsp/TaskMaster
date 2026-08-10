import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./components/auth/LoginPage";
import { RegisterPage } from "./components/auth/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CalendarPage } from "./pages/CalendarPage";
import { MatrixPage } from "./pages/MatrixPage";
import { GraphPage } from "./pages/GraphPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { AdminPage } from "./pages/AdminPage";
import { ProfilePage } from "./pages/ProfilePage";
import { MigrationPage } from "./pages/MigrationPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function MigrationGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [migrationRequired, setMigrationRequired] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setMigrationRequired(d.migrationRequired === true))
      .catch(() => setMigrationRequired(false))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (migrationRequired) return <MigrationPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <MigrationGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="matrix" element={<MatrixPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route
            path="admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MigrationGate>
  );
}
