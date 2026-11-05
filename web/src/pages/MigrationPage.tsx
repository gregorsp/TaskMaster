import { useState, useEffect } from "react";
import { Box, Card, Stack, TextField, Button, Typography, Alert, CircularProgress } from "@mui/material";
import { useAuth } from "../context/AuthContext";
import { login as authLogin } from "../api/authApi";
import { getMigrationStatus, runMigration } from "../api/migrationApi";

const RESTART_POLL_MS = 1_500;
const RESTART_TIMEOUT_MS = 90_000;

export function MigrationPage() {
  const { user, isLoading, login: setUser, logout } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [status, setStatus] = useState<{ currentVersion: number; targetVersion: number } | null>(null);
  const [statusError, setStatusError] = useState("");
  const [alreadyDone, setAlreadyDone] = useState(false);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [restartTimedOut, setRestartTimedOut] = useState(false);

  useEffect(() => {
    if (!user?.isAdmin) return;
    getMigrationStatus()
      .then((res) => {
        if (res.migrationRequired) {
          setStatus({ currentVersion: res.currentVersion, targetVersion: res.targetVersion });
        } else {
          setAlreadyDone(true);
        }
      })
      .catch(() => setStatusError("Migrationsstatus konnte nicht geladen werden."));
  }, [user]);

  /**
   * Nach der Migration beendet sich der Server selbst und Docker startet ihn mit
   * vollem Routensatz neu. Wir warten, bis er wieder antwortet und ohne
   * Migrationsbedarf meldet – erst dann lohnt ein Reload, sonst landet die Seite
   * im leeren Fenster zwischen Beenden und Neustart.
   */
  useEffect(() => {
    if (!result) return;
    let stopped = false;
    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      if (stopped) return;
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (response.ok) {
          const health = (await response.json()) as { migrationRequired?: boolean };
          if (health.migrationRequired === false) {
            stopped = true;
            window.clearInterval(timer);
            window.location.reload();
            return;
          }
        }
      } catch {
        // Server ist noch weg – weiter warten.
      }
      if (Date.now() - startedAt > RESTART_TIMEOUT_MS) {
        stopped = true;
        window.clearInterval(timer);
        setRestartTimedOut(true);
      }
    }, RESTART_POLL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [result]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const data = await authLogin(email, password);
      setUser(data.user);
    } catch {
      setLoginError("Ungültige Anmeldedaten.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setError("");
    try {
      const res = await runMigration();
      if (res.success) {
        setResult(res.message);
      } else {
        setError(res.message);
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : "Migration fehlgeschlagen.";
      setError(msg || "Migration fehlgeschlagen.");
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) {
    return (
      <Box sx={centerStyle}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <Box sx={centerStyle}>
        <Card sx={cardStyle}>
          <Typography variant="h4" fontWeight={700} textAlign="center" mb={3}>
            TaskMaster
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Datenbank-Migration erforderlich. Bitte als Administrator anmelden.
          </Alert>
          <form onSubmit={handleLogin}>
            {loginError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {loginError}
              </Alert>
            )}
            <TextField
              label="E-Mail"
              type="email"
              fullWidth
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              label="Passwort"
              type="password"
              fullWidth
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Button type="submit" variant="contained" fullWidth disabled={loginLoading}>
              {loginLoading ? "Anmelden…" : "Anmelden"}
            </Button>
          </form>
        </Card>
      </Box>
    );
  }

  if (!user.isAdmin) {
    return (
      <Box sx={centerStyle}>
        <Card sx={cardStyle}>
          <Typography variant="h5" fontWeight={700} mb={2}>
            Datenbank-Migration
          </Typography>
          <Alert severity="error" sx={{ mb: 2 }}>
            Nur ein Administrator kann die Datenbank-Migration durchführen. Bitte melde dich mit einem Admin-Konto an.
          </Alert>
          <Button
            variant="outlined"
            fullWidth
            onClick={async () => {
              await logout();
            }}
          >
            Abmelden
          </Button>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={centerStyle}>
      <Card sx={{ ...cardStyle, maxWidth: 500 }}>
        <Typography variant="h5" fontWeight={700} mb={3}>
          Datenbank-Migration
        </Typography>

        {alreadyDone && !status && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Die Datenbank ist bereits aktuell. Der Server startet nach einer Migration selbst neu – falls die
            Anwendung leer bleibt, den Container einmal neu starten.
          </Alert>
        )}

        {status && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              Die Datenbank muss von Version{" "}
              <strong>{status.currentVersion}</strong> auf Version{" "}
              <strong>{status.targetVersion}</strong> migriert werden.
              <br />
              Vor der Migration wird automatisch ein Backup erstellt.
            </Alert>
            {result ? (
              <>
                <Alert severity="success" sx={{ mb: 2 }}>
                  {result}
                </Alert>
                {restartTimedOut ? (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    Der Server meldet sich nicht zurück. Bitte den Container neu starten
                    (<code>docker compose restart taskmaster</code>) und diese Seite dann neu laden.
                  </Alert>
                ) : (
                  <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
                    <CircularProgress size={18} />
                    <Typography variant="body2">
                      Server startet neu – die Anwendung lädt automatisch, sobald er wieder da ist.
                    </Typography>
                  </Stack>
                )}
                <Button variant="outlined" fullWidth onClick={() => window.location.reload()}>
                  Jetzt neu laden
                </Button>
              </>
            ) : (
              <Button
                variant="contained"
                fullWidth
                disabled={running}
                onClick={handleRun}
                startIcon={running ? <CircularProgress size={20} /> : undefined}
              >
                {running ? "Migriere…" : "Backup erstellen & migrieren"}
              </Button>
            )}
          </>
        )}

        {statusError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {statusError}
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Card>
    </Box>
  );
}

const centerStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  bgcolor: "background.default",
};

const cardStyle = {
  p: 4,
  width: "100%",
  maxWidth: 400,
};
