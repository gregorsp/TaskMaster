import { useState, useRef, useEffect } from "react";
import {
  Box, Typography, TextField, Button, Stack, Avatar, Paper, Divider, Slider,
} from "@mui/material";
import { PhotoCamera as PhotoCameraIcon, Delete as DeleteIcon, Edit as EditIcon } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotifyContext";
import { updateProfile, changePassword, uploadProfilePicture, deleteProfilePicture, updateCapacity } from "../api/authApi";

const WEEKDAYS = [
  { key: "mon", label: "Mo" },
  { key: "tue", label: "Di" },
  { key: "wed", label: "Mi" },
  { key: "thu", label: "Do" },
  { key: "fri", label: "Fr" },
  { key: "sat", label: "Sa" },
  { key: "sun", label: "So" },
];

const DEFAULT_CAPACITY: Record<string, number> = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };

function trackColor(v: number) {
  if (v <= 0) return "grey.300";
  if (v <= 5) return "success.main";
  if (v <= 10) return "warning.main";
  return "error.main";
}

function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 50%, 40%)`;
}

export function ProfilePage() {
  const { user, login } = useAuth();
  const notify = useNotify();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profilePicture, setProfilePicture] = useState<string | null>(user?.profilePicture ?? null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [capacity, setCapacity] = useState<Record<string, number>>(DEFAULT_CAPACITY);
  const [savingCapacity, setSavingCapacity] = useState(false);

  useEffect(() => {
    const c = user?.capacity;
    setCapacity({
      mon: c?.mon ?? 0, tue: c?.tue ?? 0, wed: c?.wed ?? 0, thu: c?.thu ?? 0,
      fri: c?.fri ?? 0, sat: c?.sat ?? 0, sun: c?.sun ?? 0,
    });
  }, [user?.capacity]);

  const handleCapacityChange = (key: string, value: number) => {
    setCapacity((prev) => ({ ...prev, [key]: value }));
  };

  const totalPomodoros = Object.values(capacity).reduce((sum, v) => sum + v, 0);

  const handleSaveCapacity = async () => {
    setSavingCapacity(true);
    try {
      const saved = await updateCapacity(capacity);
      if (user) login({ ...user, capacity: saved });
      notify("Tagesbudget gespeichert", "success");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify(msg || "Fehler beim Speichern", "error");
    } finally {
      setSavingCapacity(false);
    }
  };

  const handleUpdateProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await updateProfile({ displayName, email });
      login(updated);
      setDisplayName(updated.displayName);
      setEmail(updated.email);
      notify("Profil gespeichert", "success");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify(msg || "Fehler beim Speichern", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      notify("Passwörter stimmen nicht überein", "error");
      return;
    }
    if (newPassword.length < 8) {
      notify("Passwort muss mindestens 8 Zeichen lang sein", "error");
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify("Passwort geändert", "success");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify(msg || "Fehler beim Ändern des Passworts", "error");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      const url = await uploadProfilePicture(file);
      setProfilePicture(url);
      if (user) login({ ...user, profilePicture: url });
      notify("Profilbild aktualisiert", "success");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify(msg || "Fehler beim Hochladen", "error");
    }
  };

  const handleDeletePicture = async () => {
    try {
      await deleteProfilePicture();
      setProfilePicture(null);
      if (user) login({ ...user, profilePicture: null });
      notify("Profilbild entfernt", "success");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify(msg || "Fehler beim Löschen", "error");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleFileUpload(file);
    }
  };

  return (
    <Box maxWidth={640}>
      <Typography variant="h4" mb={3}>Profil</Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack spacing={3} alignItems="center">
          <Box
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            sx={{ position: "relative", cursor: "pointer" }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Avatar
              src={profilePicture ?? undefined}
              sx={{
                width: 128,
                height: 128,
                fontSize: 48,
                bgcolor: user ? hashColor(user.id) : "secondary.main",
              }}
            >
              {user?.displayName?.charAt(0)?.toUpperCase()}
            </Avatar>
            <Paper
              sx={{
                position: "absolute",
                bottom: 0,
                right: 0,
                borderRadius: "50%",
                p: 0.5,
                bgcolor: "primary.main",
              }}
              elevation={2}
            >
              <PhotoCameraIcon sx={{ color: "white", fontSize: 18 }} />
            </Paper>
          </Box>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={() => fileInputRef.current?.click()}>
              Bild wählen
            </Button>
            {profilePicture && (
              <Button variant="outlined" size="small" color="error" startIcon={<DeleteIcon />} onClick={handleDeletePicture}>
                Entfernen
              </Button>
            )}
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Zum Ändern klicken oder Bild hier ablegen (max. 20 MB)
          </Typography>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={2}>Stammdaten</Typography>
        <Stack spacing={2}>
          <TextField
            label="Anzeigename"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            fullWidth
          />
          <TextField
            label="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            type="email"
          />
          <Button
            variant="contained"
            onClick={handleUpdateProfile}
            loading={savingProfile}
            disabled={!displayName.trim()}
          >
            Speichern
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" mb={1}>Tagesbudget (Pomodoros pro Tag)</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          1 Pomodoro ≈ 25 Minuten. Wird für Auslastungs-Warnungen im Kalender verwendet.
        </Typography>

        <Stack direction="row" justifyContent="center" spacing={1.5} sx={{ overflowX: "auto", py: 2 }}>
          {WEEKDAYS.map((d) => {
            const v = capacity[d.key] ?? 0;
            return (
              <Stack key={d.key} alignItems="center" spacing={0.5} sx={{ flex: "0 0 auto" }}>
                <Box
                  sx={{
                    height: 150,
                    width: 52,
                    p: 1,
                    borderRadius: "16px",
                    border: "2px solid",
                    borderColor: "divider",
                    bgcolor: "action.hover",
                    boxShadow: "inset 0 2px 6px rgba(0,0,0,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Slider
                    orientation="vertical"
                    min={0}
                    max={20}
                    step={1}
                    value={Math.min(v, 20)}
                    onChange={(_, val) => handleCapacityChange(d.key, val as number)}
                    valueLabelDisplay="auto"
                    sx={{
                      height: "100%",
                      "& .MuiSlider-track": { border: "none", bgcolor: trackColor(v) },
                      "& .MuiSlider-rail": { bgcolor: "grey.300" },
                    }}
                  />
                </Box>
                <TextField
                  type="number"
                  size="small"
                  value={v}
                  onChange={(e) =>
                    handleCapacityChange(d.key, e.target.value === "" ? 0 : Math.max(0, Math.min(99, Number(e.target.value) || 0)))
                  }
                  inputProps={{ min: 0, max: 99 }}
                  sx={{ width: 56 }}
                />
                <Typography variant="caption" fontWeight={600}>{d.label}</Typography>
              </Stack>
            );
          })}
        </Stack>

        <Box sx={{ textAlign: "center", my: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            Gesamt: {totalPomodoros} Pomodoro{totalPomodoros === 1 ? "" : "s"} / Woche
          </Typography>
        </Box>

        <Stack direction="row" justifyContent="flex-end">
          <Button variant="contained" onClick={handleSaveCapacity} loading={savingCapacity}>
            Speichern
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" mb={2}>Passwort ändern</Typography>
        <Stack spacing={2}>
          <TextField
            label="Aktuelles Passwort"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            fullWidth
          />
          <TextField
            label="Neues Passwort"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            fullWidth
            helperText="Mindestens 8 Zeichen"
          />
          <TextField
            label="Neues Passwort bestätigen"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            fullWidth
            error={confirmPassword.length > 0 && newPassword !== confirmPassword}
            helperText={confirmPassword.length > 0 && newPassword !== confirmPassword ? "Passwörter stimmen nicht überein" : ""}
          />
          <Button
            variant="contained"
            onClick={handleChangePassword}
            loading={savingPassword}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Passwort ändern
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
