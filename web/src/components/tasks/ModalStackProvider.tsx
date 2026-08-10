import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Breadcrumbs, Link, Box } from "@mui/material";
import { NavigateNext as NavigateNextIcon } from "@mui/icons-material";
import type { TaskWithRelations } from "../../api/tasksApi";

interface ModalStackEntry {
  task: TaskWithRelations;
  depth: number;
}

interface ModalStackContextValue {
  stack: ModalStackEntry[];
  push: (task: TaskWithRelations) => void;
  popTo: (depth: number) => void;
  closeAll: () => void;
  activeTask: TaskWithRelations | null;
}

const ModalStackContext = createContext<ModalStackContextValue | null>(null);

export function useModalStack() {
  const ctx = useContext(ModalStackContext);
  if (!ctx) throw new Error("useModalStack must be used within ModalStackProvider");
  return ctx;
}

export function ModalStackProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalStackEntry[]>([]);

  const push = useCallback((task: TaskWithRelations) => {
    setStack((prev) => [...prev, { task, depth: prev.length }]);
  }, []);

  const popTo = useCallback((depth: number) => {
    setStack((prev) => prev.slice(0, depth));
  }, []);

  const closeAll = useCallback(() => {
    setStack([]);
  }, []);

  const activeTask = stack.length > 0 ? stack[stack.length - 1].task : null;

  return (
    <ModalStackContext.Provider value={{ stack, push, popTo, closeAll, activeTask }}>
      {children}
      {stack.length > 0 && (
        <BreadcrumbBar stack={stack} onNavigate={popTo} />
      )}
    </ModalStackContext.Provider>
  );
}

function BreadcrumbBar({ stack, onNavigate }: { stack: ModalStackEntry[]; onNavigate: (depth: number) => void }) {
  return (
    <Box
      sx={{
        position: "fixed",
        top: 64,
        left: 0,
        right: 0,
        zIndex: 1400,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        px: 3,
        py: 1,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="task stack">
        <Link
          component="button"
          underline="hover"
          color="inherit"
          onClick={() => onNavigate(0)}
          sx={{ fontSize: 13 }}
        >
          Aufgaben
        </Link>
        {stack.map((entry, idx) => (
          <Link
            key={entry.task.id}
            component="button"
            underline="hover"
            color={idx === stack.length - 1 ? "text.primary" : "inherit"}
            onClick={() => onNavigate(idx + 1)}
            sx={{
              fontSize: 13,
              fontWeight: idx === stack.length - 1 ? 600 : 400,
              maxWidth: 250,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.task.title}
          </Link>
        ))}
      </Breadcrumbs>
    </Box>
  );
}
