import { Component, type ReactNode } from "react";
import { Typography, Box, Alert, Button } from "@mui/material";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error.message, info.componentStack?.slice(0, 200));
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <Box sx={{ p: 4, maxWidth: 400, mx: "auto", mt: 4 }}>
            <Alert severity="error" sx={{ mb: 2 }}>
              Fehler beim Anzeigen der Komponente: {this.state.error?.message}
            </Alert>
            <Button variant="outlined" onClick={() => this.setState({ hasError: false, error: null })}>
              Erneut versuchen
            </Button>
          </Box>
        )
      );
    }
    return this.props.children;
  }
}
