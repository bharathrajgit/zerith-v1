/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

const AuthContext = createContext(null);
const DIAGNOSTIC_STORAGE_KEY = "dsa_diag_completed";

const syncDiagnosticStorage = (userType, user) => {
  if (userType !== "student") {
    localStorage.removeItem(DIAGNOSTIC_STORAGE_KEY);
    return;
  }

  const completed = user?.diagnosticCompleted === true;
  localStorage.setItem(DIAGNOSTIC_STORAGE_KEY, completed ? "true" : "false");
};

const clearStoredSession = () => {
  console.log('[AuthContext] clearStoredSession called - clearing localStorage');
  localStorage.removeItem("dsa_token");
  localStorage.removeItem("dsa_user_type");
  localStorage.removeItem(DIAGNOSTIC_STORAGE_KEY);
};

export const AuthProvider = ({ children }) => {
  const [state, setState] = useState({
    user: null,
    token: null,
    userType: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const navigate = useNavigate();

  const persistAuthState = useCallback((user, token, userType) => {
    if (token) {
      localStorage.setItem("dsa_token", token);
      console.log('[AuthContext] Token saved to localStorage:', !!token);
    }
    if (userType) {
      localStorage.setItem("dsa_user_type", userType);
      console.log('[AuthContext] UserType saved to localStorage:', userType);
    }
    syncDiagnosticStorage(userType, user);
  }, []);

  const loadUser = useCallback(async () => {
    console.log('[AuthContext] loadUser called');
    const token = localStorage.getItem("dsa_token");
    let userType = localStorage.getItem("dsa_user_type");
    console.log('[AuthContext] Token from localStorage:', !!token, 'UserType:', userType);

    if (!token) {
      console.log('[AuthContext] No token found, clearing session');
      clearStoredSession();
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      let userData = null;
      let resolvedType = userType;

      const fetchStudent = async () => {
        const res = await api.get("/auth/me");
        return res.data.data?.user || res.data.user || res.data;
      };
      const fetchInstitution = async () => {
        const res = await api.get("/institution/auth/profile");
        return res.data.data?.institution || res.data.institution || res.data;
      };

      if (userType === "student") {
        userData = await fetchStudent();
      } else if (userType === "institution") {
        userData = await fetchInstitution();
      } else {
        try {
          userData = await fetchStudent();
          resolvedType = "student";
        } catch {
          userData = await fetchInstitution();
          resolvedType = "institution";
        }
      }

      if (!userData) throw new Error("Failed to restore session");
      persistAuthState(userData, token, resolvedType);
      setState({
        user: userData,
        token,
        userType: resolvedType,
        isLoading: false,
        isAuthenticated: true,
      });
      console.log('[AuthContext] User loaded successfully, isAuthenticated set to true');
    } catch (error) {
      console.error('[AuthContext] loadUser error:', error);
      clearStoredSession();
      setState({ user: null, token: null, userType: null, isLoading: false, isAuthenticated: false });
    }
  }, [persistAuthState]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUser();
  }, [loadUser]);

  const loginStudent = async (email, password) => {
    try {
      const res = await api.post("/auth/login", { email, password });
      const { token } = res.data;
      const user = res.data.data?.user || res.data.user;
      const mustResetPassword = res.data.data?.mustResetPassword || res.data.mustResetPassword;
      persistAuthState(user, token, "student");
      setState({ user, token, userType: "student", isLoading: false, isAuthenticated: true });
      return { success: true, mustReset: mustResetPassword || user?.mustResetPassword };
    } catch (error) {
      return {
        success: false,
        message: error?.response?.data?.message || error?.message || 'Login failed',
      };
    }
  };

  const loginInstitution = async (email, password) => {
    try {
      console.log('[AuthContext] Attempting institution login with email:', email);
      const res = await api.post("/institution/auth/login", { email, password });
      console.log('[AuthContext] Institution login response:', res.data);
      const { token } = res.data;
      const institution = res.data.data?.institution || res.data.institution;
      console.log('[AuthContext] Institution data:', institution);
      
      // First persist to localStorage
      persistAuthState(institution, token, "institution");
      console.log('[AuthContext] Auth state persisted to localStorage');
      
      // Then update React state
      setState({ user: institution, token, userType: "institution", isLoading: false, isAuthenticated: true });
      console.log('[AuthContext] React state updated');
      
      return { success: true };
    } catch (error) {
      console.error('[AuthContext] Institution login error:', error);
      return {
        success: false,
        message: error?.response?.data?.message || error?.message || 'Login failed',
      };
    }
  };

  const registerStudent = async (formData) => {
    try {
      const res = await api.post("/auth/register", formData);
      const { token } = res.data;
      const user = res.data.data?.user || res.data.user;
      const mustResetPassword = res.data.data?.mustResetPassword || user?.mustResetPassword;
      persistAuthState(user, token, "student");
      setState({ user, token, userType: "student", isLoading: false, isAuthenticated: true });
      return { success: true, user, mustReset: mustResetPassword || user?.mustResetPassword };
    } catch (error) {
      return {
        success: false,
        message: error?.response?.data?.message || error?.message || 'Registration failed',
      };
    }
  };

  const registerInstitution = async (formData) => {
    try {
      const res = await api.post("/institution/auth/register", formData);
      const { token } = res.data;
      const institution = res.data.data?.institution || res.data.institution;
      persistAuthState(institution, token, "institution");
      setState({ user: institution, token, userType: "institution", isLoading: false, isAuthenticated: true });
      return { success: true, institutionCode: institution?.institutionCode };
    } catch (error) {
      return {
        success: false,
        message: error?.response?.data?.message || error?.message || 'Registration failed',
      };
    }
  };

  const logout = () => {
    clearStoredSession();
    setState({ user: null, token: null, userType: null, isLoading: false, isAuthenticated: false });
    navigate("/");
  };

  const updateUser = (updates) => {
    setState((prev) => {
      const nextUser = { ...prev.user, ...updates };
      syncDiagnosticStorage(prev.userType, nextUser);
      return { ...prev, user: nextUser };
    });
  };

  const refreshUser = useCallback(async () => {
    const activeUserType = state.userType || localStorage.getItem("dsa_user_type");
    if (!activeUserType) {
      return { success: false, message: "No active session" };
    }

    const res = activeUserType === "student"
      ? await api.get("/auth/me")
      : await api.get("/institution/auth/profile");

    const user = activeUserType === "student"
      ? (res.data.data?.user || res.data.user || res.data)
      : (res.data.data?.institution || res.data.institution || res.data);

    setState((prev) => ({ ...prev, user, userType: activeUserType, isLoading: false, isAuthenticated: true }));
    syncDiagnosticStorage(activeUserType, user);
    return { success: true, user };
  }, [state.userType]);

  const updateProfile = async (updates) => {
    try {
      const res = await api.put('/auth/profile', updates);
      if (res.data.success) {
        setState((prev) => ({ ...prev, user: res.data.data.user }));
        syncDiagnosticStorage("student", res.data.data.user);
        return { success: true, user: res.data.data.user };
      }
      return { success: false, message: res.data.message };
    } catch (err) {
      return { success: false, message: err.response?.data?.message || 'Update failed' };
    }
  };

  const resetFirstPassword = async (payload) => {
    const res = await api.put('/auth/reset-first-password', payload);
    const { token } = res.data;
    const user = res.data.data?.user || res.data.user;

    if (token) {
      localStorage.setItem('dsa_token', token);
    }
    localStorage.setItem('dsa_user_type', 'student');
    syncDiagnosticStorage('student', user);

    setState((prev) => ({
      ...prev,
      user,
      token: token || prev.token,
      userType: 'student',
      isLoading: false,
      isAuthenticated: true,
    }));

    return {
      success: true,
      user,
      nextPath: user?.diagnosticCompleted ? '/roadmap' : '/diagnostic',
    };
  };

  return (
    <AuthContext.Provider value={{ ...state, loginStudent, loginInstitution, registerStudent, registerInstitution, resetFirstPassword, refreshUser, logout, updateUser, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export default AuthContext;
