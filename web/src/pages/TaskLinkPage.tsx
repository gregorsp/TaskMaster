import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Box, Button } from "@mui/material";
import { DashboardPage } from "./DashboardPage";
import { getTaskBySlug } from "../api/tasksApi";
import { useModalStack } from "../components/tasks/ModalStackProvider";

/**
 * Öffnet eine Aufgabenkarte direkt über einen geteilten Link (/t/<slug>).
 * Der Slug wird serverseitig aufgelöst (Sichtbarkeitsregeln greifen); die
 * Dashboard-Übersicht bleibt als Hintergrund sichtbar, die TaskCard erscheint
 * als Dialog darüber. Schließen der Karte führt zurück zu "/".
 */
export function TaskLinkPage() {
  const { slug } = useParams<{ slug: string }>();
  const { push, stack } = useModalStack();
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const resolvedRef = useRef(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!slug || resolvedRef.current) return;
    resolvedRef.current = true;
    getTaskBySlug(slug)
      .then((t) => push({ id: t.id, title: t.title }))
      .catch(() => setError(true));
  }, [slug, push]);

  useEffect(() => {
    if (stack.length > 0) {
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      navigate("/", { replace: true });
    }
  }, [stack.length, navigate]);

  return (
    <Box>
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}
          action={<Button color="inherit" size="small" onClick={() => navigate("/", { replace: true })}>Zur Übersicht</Button>}>
          Aufgabe nicht gefunden oder keine Berechtigung.
        </Alert>
      )}
      <DashboardPage />
    </Box>
  );
}
