import axios from "axios";

const rawApiUrl = import.meta.env.VITE_API_URL;
const localApiUrl = "http://localhost:5000";
const allowRemoteApiOnLocalhost = import.meta.env.VITE_ALLOW_REMOTE_API_ON_LOCALHOST === "true";
const PUBLIC_AUTH_ROUTES = new Set([
  "/auth/login",
  "/auth/register",
  "/institution/auth/login",
  "/institution/auth/register",
]);

const isLocalHostname = (value = "") =>
  value === "localhost" || value === "127.0.0.1";

const normalizeRequestPath = (value = "") => {
  if (!value) return "";

  try {
    const path = /^https?:\/\//i.test(value)
      ? new URL(value).pathname
      : value;

    return path.replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "");
  } catch {
    return String(value).replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "");
  }
};

const isPublicAuthRoute = (value = "") =>
  PUBLIC_AUTH_ROUTES.has(normalizeRequestPath(value));

const isRemoteHttpUrl = (value = "") => {
  if (!/^https?:\/\//i.test(value)) return false;

  try {
    const parsed = new URL(value);
    return !isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
};

const shouldPreferLocalApi =
  typeof window !== "undefined"
  && isLocalHostname(window.location.hostname)
  && isRemoteHttpUrl(rawApiUrl)
  && !allowRemoteApiOnLocalhost;

const useLocalDevProxy =
  import.meta.env.DEV
  && typeof window !== "undefined"
  && isLocalHostname(window.location.hostname)
  && !allowRemoteApiOnLocalhost;

const normalizedApiUrl = shouldPreferLocalApi
  ? localApiUrl
  : rawApiUrl
    ? rawApiUrl.replace(/\/+$/, "")
    : localApiUrl;

const api = axios.create({
  baseURL: useLocalDevProxy
    ? "/api"
    : normalizedApiUrl.endsWith("/api")
      ? normalizedApiUrl
      : `${normalizedApiUrl}/api`,
  timeout: 30000,
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("dsa_token");
    const userType = localStorage.getItem("dsa_user_type");
    const requestPath = normalizeRequestPath(config.url);
    const skipAuthHeader = isPublicAuthRoute(requestPath);

    if (token && !skipAuthHeader) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log(`📤 [Request] ${config.method.toUpperCase()} ${config.url} | Token: ${token.substring(0, 20)}... | UserType: ${userType}`);
    } else if (!token && !skipAuthHeader) {
      console.warn(`⚠️ [Request] ${config.method.toUpperCase()} ${config.url} | NO TOKEN FOUND`);
    }

    config.headers["Content-Type"] = "application/json";

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Network/server unavailable
    if (!error.response) {
      console.error("Network Error:", error.message);
      return Promise.reject(error);
    }

    // Unauthorized - handle gracefully
    if (error.response.status === 401) {
      const requestPath = normalizeRequestPath(error.config?.url);

      if (isPublicAuthRoute(requestPath)) {
        return Promise.reject(error);
      }

      const timestamp = new Date().toLocaleTimeString();
      const errorDetails = {
        timestamp,
        url: requestPath || error.config?.url,
        method: error.config?.method?.toUpperCase(),
        message: error.response.data?.message,
        fullResponse: error.response.data,
        tokenPresent: !!localStorage.getItem('dsa_token'),
        userType: localStorage.getItem('dsa_user_type'),
      };

      console.error('🔴 401 UNAUTHORIZED ERROR at', timestamp);
      console.error('❌ Request URL:', errorDetails.url);
      console.error('❌ Method:', errorDetails.method);
      console.error('❌ Error Message:', errorDetails.message);
      console.error('❌ Token Present:', errorDetails.tokenPresent);
      console.error('❌ UserType:', errorDetails.userType);
      console.error('❌ Full Error Response:', errorDetails.fullResponse);
      
      // Save to sessionStorage so it persists through page reload
      sessionStorage.setItem('lastAuthError', JSON.stringify(errorDetails));
      
      // Prevent redirect loop - only redirect if we haven't already cleared the token
      const hadToken = !!localStorage.getItem("dsa_token");
      
      if (hadToken) {
        const userType = localStorage.getItem("dsa_user_type");

        localStorage.removeItem("dsa_token");
        localStorage.removeItem("dsa_user_type");
        localStorage.removeItem("dsa_diag_completed");

        const target =
          userType === "institution"
            ? "/institution/login"
            : "/login";

        if (window.location.pathname !== target) {
          console.warn('🔄 Redirecting to:', target, '| UserType was:', userType);
          // Longer delay to ensure error is visible before reload
          setTimeout(() => {
            window.location.href = target;
          }, 1000);
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
