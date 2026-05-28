import React, { createContext, useContext, useEffect, useState } from "react";
import api from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem("nexus_user");
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("nexus_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then((r) => {
        setUser(r.data);
        localStorage.setItem("nexus_user", JSON.stringify(r.data));
      })
      .catch(() => {
        localStorage.removeItem("nexus_token");
        localStorage.removeItem("nexus_user");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("nexus_token", data.token);
    localStorage.setItem("nexus_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("nexus_token");
    localStorage.removeItem("nexus_user");
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export const ROLE_LABELS = {
  super_admin: "Super Admin",
  hub_accountant: "Hub Accountant",
  warehouse_manager: "Warehouse Manager",
  franchise_manager: "Franchise Manager",
};

export const canAccess = (user, allowed) => {
  if (!user) return false;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(user.role);
};
