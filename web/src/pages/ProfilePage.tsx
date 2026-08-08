import { useState, useRef } from "react";
import {
  Box, Typography, TextField, Button, Stack, Avatar, Paper, Divider,
} from "@mui/material";
import { PhotoCamera as PhotoCameraIcon, Delete as DeleteIcon, Edit as EditIcon } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotifyContext";
import { updateProfile, changePassword, uploadProfilePicture, deleteProfilePicture } from "../api/authApi";

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
