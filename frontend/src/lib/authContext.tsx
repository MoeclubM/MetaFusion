"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, fetchApi, getAccessToken, setAuthTokens, clearAuthTokens, getRefreshToken } from "./api";

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

  const logout = () => {
    const rfToken = getRefreshToken();
    if (rfToken || token) {
      fetchApi("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: rfToken }),
      }).catch(() => {});
    }
    clearAuthTokens();
    setToken(null);
    setUser(null);
  };

  const refreshProfile = async () => {
    try {
      const profile = await fetchApi<User>("/auth/me");
      setUser(profile);
    } catch {
      logout();
    }
  };

  useEffect(() => {
    const savedToken = getAccessToken();
    if (savedToken) {
      setToken(savedToken);
      fetchApi<User>("/auth/me")
        .then((u) => setUser(u))
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
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
