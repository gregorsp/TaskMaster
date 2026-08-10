import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { NotifyProvider } from "./context/NotifyContext";
import { ThemeContextProvider } from "./context/ThemeContext";
import { ModalStackProvider } from "./components/tasks/ModalStackProvider";
import { ModalStackRenderer } from "./components/tasks/ModalStackRenderer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./index.css";

let touchStartY = 0;
document.addEventListener(
  "touchstart",
  (e) => {
    touchStartY = e.touches[0].clientY;
  },
  { passive: true }
);
document.addEventListener(
  "touchmove",
  (e) => {
    if (window.scrollY === 0 && e.touches[0].clientY > touchStartY) {
      e.preventDefault();
    }
  },
  { passive: false }
);

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeContextProvider>
          <AuthProvider>
            <NotifyProvider>
              <ErrorBoundary>
                <ModalStackProvider>
                  <App />
                  <ModalStackRenderer />
                </ModalStackProvider>
              </ErrorBoundary>
            </NotifyProvider>
          </AuthProvider>
        </ThemeContextProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
