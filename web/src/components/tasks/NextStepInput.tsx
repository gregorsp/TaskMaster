import { useState } from "react";
import { Button, Stack, TextField } from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { createTask } from "../../api/tasksApi";
import { useNotify } from "../../context/NotifyContext";

interface Props {
  /** Projekt bzw. Aufgabe, unter der der Schritt angelegt wird. */
  parentId: string;
  placeholder?: string;
  onAdded: () => void;
}

/**
 * Legt einen Schritt als Unteraufgabe an. Den Status setzt der Server:
 * Hat das Projekt noch keinen Nächsten Schritt, wird es dieser.
 */
export function NextStepInput({ parentId, placeholder = "Nächster Schritt …", onAdded }: Props) {
  const notify = useNotify();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await createTask({ title, parentId });
      setText("");
      notify(`Schritt „${title}“ angelegt`);
      onAdded();
    } catch {
      notify("Schritt konnte nicht angelegt werden", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack direction="row" spacing={1}>
      <TextField
        size="small" fullWidth placeholder={placeholder} value={text} disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
        inputProps={{ enterKeyHint: "done" }}
      />
      <Button variant="contained" size="small" onClick={submit} disabled={busy || !text.trim()} sx={{ minWidth: 0, px: 1.5 }}
        aria-label="Schritt hinzufügen">
        <AddIcon fontSize="small" />
      </Button>
    </Stack>
  );
}
