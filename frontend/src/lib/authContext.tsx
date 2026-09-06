"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, getAccessToken, setAuthTokens, clearAuthTokens } from "./api";

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
      await fetch("/api/v2/auth/logout", {
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
      const res = await fetch("/api/v2/auth/me", {
        credentials: "same-origin",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error("unauthorized");
      }
      const u = await res.json();
      setUser({
        id: u.id,
        username: u.username,
        role: u.role,
        email: u.email || `${u.username}@metafusion.local`,
        display_name: u.username,
      });
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
    fetch("/api/v2/auth/me", {
      credentials: "same-origin",
      headers: savedToken ? { Authorization: `Bearer ${savedToken}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error("unauthorized");
        return res.json();
      })
      .then((u) => {
        setUser({
          id: u.id,
          username: u.username,
          role: u.role,
          email: u.email || `${u.username}@metafusion.local`,
          display_name: u.username,
        });
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
