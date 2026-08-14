import axios from "axios";
import { startLoading, stopLoading } from "./loadingTracker";

declare module "axios" {
  export interface AxiosRequestConfig {
    skipLoadingIndicator?: boolean;
  }
}

const client = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

let accessToken: string | null = null;

const authExpiredListeners = new Set<() => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function onAuthExpired(listener: () => void): () => void {
  authExpiredListeners.add(listener);
  return () => authExpiredListeners.delete(listener);
}

client.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  if (!config.skipLoadingIndicator) startLoading();
  return config;
});

client.interceptors.response.use(
  (response) => {
    if (!response.config.skipLoadingIndicator) stopLoading();
    return response;
  },
  async (error) => {
    if (!error.config?.skipLoadingIndicator) stopLoading();
    const original = error.config;
    const url = original?.url ?? "";

    const isAuthEndpoint =
      url.includes("/auth/login") ||
      url.includes("/auth/register") ||
      url.includes("/auth/refresh");

    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;

      try {
        const { data } = await axios.post("/api/auth/refresh", {}, { withCredentials: true });
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return client(original);
      } catch {
        setAccessToken(null);
        authExpiredListeners.forEach((fn) => fn());
      }
    }

    return Promise.reject(error);
  }
);

export default client;
