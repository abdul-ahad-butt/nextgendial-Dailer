import React, { createContext, useContext, useState, useEffect } from 'react';
import { decodeJWT } from '../lib/jwt';

export interface User {
  sub: string;
  role: 'admin' | 'agent';
  exp?: number;
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      const decoded = decodeJWT(storedToken) as User | null;
      if (decoded && (!decoded.exp || decoded.exp * 1000 > Date.now())) {
        setToken(storedToken);
        setUser(decoded);
      } else {
        localStorage.removeItem('auth_token');
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newToken: string) => {
    const decoded = decodeJWT(newToken) as User | null;
    if (decoded) {
      localStorage.setItem('auth_token', newToken);
      setToken(newToken);
      setUser(decoded);
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
