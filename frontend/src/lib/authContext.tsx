"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, clearAuthTokens, normalizeSessionUser } from "./api";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: () => {},
  refreshProfile: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {}
    clearAuthTokens();
    setUser(null);
  };

  const refreshProfile = async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("unauthorized");
      }
      const u = await res.json();
      setUser(normalizeSessionUser(u));
    } catch {
      clearAuthTokens();
      setUser(null);
    }
  };

  useEffect(() => {
    // 旧版主站曾把 Bearer 留在 localStorage；账号应用现在只更新 Cookie。
    // 先删旧凭据，再从 /me 读取同域 Cookie，避免两个账号的身份发生冲突。
    clearAuthTokens();
    fetch("/api/auth/me", {
      credentials: "same-origin",
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

  return (
    <AuthContext.Provider value={{ user, loading, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
