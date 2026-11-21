import { useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box, Typography, Paper, Stack, Switch, FormControlLabel, Button,
  TextField, MenuItem, Alert, Divider, Link,
} from "@mui/material";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotifyContext";
import {
  updateDefaultPrivate, updateHabitConfirm, updateTranscriptionLanguage,
  saveAiKey, clearAiKey,
} from "../api/authApi";

const LEGACY_KEYS = [
  "taskmaster_ai_api_key",
  "taskmaster_gemini_key",
  "taskmaster_deepseek_key",
  "taskmaster_ai_provider",
];

export function SettingsPage() {
  const { user, login } = useAuth();
  const notify = useNotify();
  const [defaultPrivate, setDefaultPrivate] = useState(user?.defaultPrivate ?? true);
  const [aiProvider, setAiProvider] = useState<"gemini" | "deepseek">(user?.aiProvider ?? "gemini");
  const [aiKey, setAiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [autoTranscribe, setAutoTranscribe] = useState(() => localStorage.getItem("taskmaster.autoTranscribe") === "true");
  const migrated = useRef(false);

  useEffect(() => {
    if (user) setDefaultPrivate(user.defaultPrivate);
  }, [user?.defaultPrivate]);

  useEffect(() => {
    if (user) setAiProvider(user.aiProvider ?? "gemini");
  }, [user?.aiProvider]);

  // Einmaliger Umzug: ein noch im Browser liegender Schlüssel wandert auf den Server.
  useEffect(() => {
    if (!user || migrated.current) return;
    migrated.current = true;
    const legacy = LEGACY_KEYS.map((k) => localStorage.getItem(k)).filter((v): v is string => !!v);
    if (legacy.length === 0) return;
    if (user.hasAiKey) {
      LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
      return;
    }
    const key = legacy.find((v) => v.startsWith("AIza") || v.startsWith("AQ."))
      || legacy.find((v) => v.startsWith("sk-"))
      || legacy[0];
    const provider: "gemini" | "deepseek" = key.startsWith("AIza") || key.startsWith("AQ.") ? "gemini" : "deepseek";
    saveAiKey(provider, key)
      .then((updated) => {
        login(updated);
        LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
        notify("KI-Schlüssel aus dem Browser übernommen");
      })
      .catch(() => {});
  }, [user]);

  const handleDefaultPrivate = async (value: boolean) => {
    setDefaultPrivate(value);
    try {
      const updated = await updateDefaultPrivate(value);
      login(updated);
    } catch {
      setDefaultPrivate(!value);
      notify("Einstellung konnte nicht gespeichert werden", "error");
    }
  };

  const handleHabitConfirm = async (value: boolean) => {
    try {
      login(await updateHabitConfirm(value));
    } catch {
      notify("Einstellung konnte nicht gespeichert werden", "error");
    }
  };

  const handleLanguage = async (value: "de" | "en" | "auto") => {
    try {
      login(await updateTranscriptionLanguage(value));
    } catch {
      notify("Einstellung konnte nicht gespeichert werden", "error");
    }
  };

  const handleSaveKey = async () => {
    if (!aiKey.trim()) return;
    setSavingKey(true);
    try {
      login(await saveAiKey(aiProvider, aiKey.trim()));
      setAiKey("");
      notify("KI-Schlüssel gespeichert");
    } catch {
      notify("Schlüssel konnte nicht gespeichert werden", "error");
    } finally {
      setSavingKey(false);
    }
  };

  const handleClearKey = async () => {
    try {
      login(await clearAiKey());
      notify("KI-Schlüssel entfernt");
    } catch {
      notify("Schlüssel konnte nicht entfernt werden", "error");
    }
  };

  if (!user) return null;

  return (
    <Box maxWidth={760} mx="auto">
      <Typography variant="h4" mb={2}>Einstellungen</Typography>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Allgemein</Typography>
        <FormControlLabel
          control={<Switch checked={defaultPrivate} onChange={(e) => handleDefaultPrivate(e.target.checked)} />}
          label="Neue Aufgaben standardmäßig privat"
        />
        <Typography variant="body2" color="text.secondary">
          Gilt für Formular, Quick-Add und API. Unteraufgaben erben die Privatheit ihrer Elternaufgabe.
          Stammdaten, Avatar und Passwort findest du im{" "}
          <Link component={RouterLink} to="/profile">Profil</Link>.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>KI</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Der Schlüssel wird verschlüsselt auf dem Server gespeichert und nie an den Browser zurückgegeben.
        </Typography>
        {user.hasAiKey ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            Ein Schlüssel ist hinterlegt ({user.aiProvider === "gemini" ? "Google Gemini" : "DeepSeek"}).
          </Alert>
        ) : (
          <Alert severity="info" sx={{ mb: 2 }}>
            Noch kein Schlüssel hinterlegt. Ohne Schlüssel funktionieren „KI-GTD“ und der Mindmap-Generator nicht.
          </Alert>
        )}
        <Stack spacing={2}>
          <TextField select size="small" label="Anbieter" value={aiProvider} onChange={(e) => setAiProvider(e.target.value as "gemini" | "deepseek")} sx={{ maxWidth: 220 }}>
            <MenuItem value="gemini">Google Gemini</MenuItem>
            <MenuItem value="deepseek">DeepSeek</MenuItem>
          </TextField>
          <TextField
            label="API-Schlüssel"
            type="password"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder={aiProvider === "gemini" ? "AIza… / AQ.…" : "sk-…"}
            fullWidth
          />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={handleSaveKey} disabled={savingKey || !aiKey.trim()}>
              Schlüssel speichern
            </Button>
            {user.hasAiKey && (
              <Button color="error" onClick={handleClearKey}>Schlüssel entfernen</Button>
            )}
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom>Verhalten</Typography>
        <Stack spacing={2}>
          <FormControlLabel
            control={<Switch checked={user.confirmHabitCompletion} onChange={(e) => handleHabitConfirm(e.target.checked)} />}
            label="Habit-Erledigung bestätigen lassen"
          />
          <TextField
            select size="small" label="Transkriptionssprache"
            value={user.transcriptionLanguage}
            onChange={(e) => handleLanguage(e.target.value as "de" | "en" | "auto")}
            sx={{ maxWidth: 260 }}
          >
            <MenuItem value="de">Deutsch</MenuItem>
            <MenuItem value="en">Englisch</MenuItem>
            <MenuItem value="auto">Automatisch</MenuItem>
          </TextField>
          <Box>
            <FormControlLabel
              control={<Switch checked={autoTranscribe} onChange={(e) => { setAutoTranscribe(e.target.checked); localStorage.setItem("taskmaster.autoTranscribe", String(e.target.checked)); }} />}
              label="Neue Aufnahmen automatisch transkribieren"
            />
            <Typography variant="caption" color="text.secondary" display="block">
              Diese Einstellung gilt nur für dieses Gerät.
            </Typography>
          </Box>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Link component={RouterLink} to="/audio">Audio-Übersicht öffnen</Link>
      </Paper>
    </Box>
  );
}
