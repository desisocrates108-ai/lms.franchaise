import axios from "axios";
import { toast } from "sonner";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API_BASE, timeout: 60000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("nexus_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Surface API errors so the UI never stays in a silent broken state.
let _lastErrorAt = 0;
const _showError = (msg) => {
  const now = Date.now();
  if (now - _lastErrorAt < 600) return; // dedupe bursts
  _lastErrorAt = now;
  try { toast.error(msg); } catch (_) { /* noop */ }
};

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const cfg = err?.config || {};
    const status = err?.response?.status;
    const url = cfg.url || "";

    if (status === 401) {
      localStorage.removeItem("nexus_token");
      localStorage.removeItem("nexus_user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
      return Promise.reject(err);
    }

    // Silence noisy 404s on optional endpoints
    const silent = cfg.headers?.["x-silent"] === "1";
    if (!silent) {
      if (status === 403) {
        _showError("You don't have permission for this action.");
      } else if (status === 404 && !url.includes("/audit-logs")) {
        // 404 sometimes expected; only show if not a polled endpoint
        _showError(err?.response?.data?.detail || "Not found.");
      } else if (status >= 500) {
        _showError("Server error — please try again.");
      } else if (!err.response) {
        _showError("Network error — check your connection.");
      } else if (status === 400 || status === 422) {
        const d = err.response?.data?.detail;
        if (typeof d === "string") _showError(d);
        else if (Array.isArray(d)) _showError(d[0]?.msg || "Validation error");
      }
    }
    return Promise.reject(err);
  }
);

export default api;

export const formatINR = (n) => {
  const num = Number(n || 0);
  return "₹" + num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

export const formatNum = (n) => Number(n || 0).toLocaleString("en-IN");
