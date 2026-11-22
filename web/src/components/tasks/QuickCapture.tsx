import { useState } from "react";
import { InputAdornment, TextField } from "@mui/material";
import { Inbox as InboxIcon } from "@mui/icons-material";
import { createTask } from "../../api/tasksApi";
import { useNotify } from "../../context/NotifyContext";

interface Props {
  /** Nach jedem erfassten Gedanken (z. B. Liste neu laden). */
  onCaptured?: (title: string) => void;
  autoFocus?: boolean;
}

/**
 * GTD „Sammeln“: ein Gedanke pro Enter, ohne Kategorie und Status –
 * landet damit automatisch im Eingangskorb. Das Feld bleibt zum Weitertippen offen.
 */
export function QuickCapture({ onCaptured, autoFocus = false }: Props) {
  const notify = useNotify();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await createTask({ title });
      setText("");
      onCaptured?.(title);
    } catch {
      notify("Konnte nicht erfasst werden", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TextField
      fullWidth size="small" autoFocus={autoFocus}
      placeholder="Was geht dir durch den Kopf? (Enter = in den Eingangskorb)"
      value={text} disabled={busy}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
      inputProps={{ enterKeyHint: "send" }}
      InputProps={{ startAdornment: <InputAdornment position="start"><InboxIcon fontSize="small" /></InputAdornment> }}
    />
  );
}
