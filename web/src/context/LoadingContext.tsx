import { useEffect, useState, type ReactNode } from "react";
import { Backdrop, CircularProgress } from "@mui/material";
import { onLoadingChange } from "../api/loadingTracker";

const SHOW_DELAY_MS = 250;

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [activeCount, setActiveCount] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => onLoadingChange(setActiveCount), []);

  useEffect(() => {
    if (activeCount > 0) {
      const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [activeCount]);

  return (
    <>
      {children}
      <Backdrop
        open={visible}
        sx={{ zIndex: 2000, color: "#fff", bgcolor: "rgba(0, 0, 0, 0.4)" }}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </>
  );
}
