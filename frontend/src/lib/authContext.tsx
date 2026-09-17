"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, getAccessToken, setAuthTokens, clearAuthTokens, normalizeSessionUser } from "./api";

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: User, refreshToken?: string | null) => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  login: () => {},
  logout: () => {},
  refreshProfile: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {}
    clearAuthTokens();
    setToken(null);
    setUser(null);
  };

  const refreshProfile = async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "same-origin",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error("unauthorized");
      }
      const u = await res.json();
      setUser(normalizeSessionUser(u));
    } catch {
      clearAuthTokens();
      setToken(null);
      setUser(null);
    }
  };

  useEffect(() => {
    const savedToken = getAccessToken();
    if (savedToken) {
      setToken(savedToken);
    }
    fetch("/api/auth/me", {
      credentials: "same-origin",
      headers: savedToken ? { Authorization: `Bearer ${savedToken}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json();
      })
      .then((u) => {
        // 账号服务在 /me 里给了组与权限码，映射统一在 normalizeSessionUser 里做，
        // 免得这里与登录路径各写一份、其中一份漏字段。
        setUser(normalizeSessionUser(u));
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = (newToken: string, newUser: User, newRefreshToken?: string | null) => {
    setAuthTokens(newToken, newRefreshToken);
    setToken(newToken);
    setUser(newUser);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
