import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { useSegments, useRouter, router } from 'expo-router';

type User = {
  id: number;
  name: string;
  email: string;
  role: 'customer' | 'cleaner' | 'owner';
  address: string | null;
  city: string | null;
  phone: string | null;
  avatarUrl: string | null;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  signIn: (user: User) => void;
  signOut: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = async () => {
    setIsLoading(true);
    // A 401 is a definitive "logged out" (stop immediately). Any other failure
    // (timeout / network / 5xx) is likely the free-tier server cold-starting, so
    // retry — never hang forever, never falsely bounce the user to login.
    // Timeouts step up: a short first try catches a dead socket quickly, then
    // longer tries ride out the ~30-60s wake-up in a single request.
    const timeouts = [12000, 60000, 60000];
    for (let attempt = 0; attempt < timeouts.length; attempt++) {
      try {
        const data = await apiFetch('/api/users/me', { timeoutMs: timeouts[attempt] });
        setUser(data);
        setIsLoading(false);
        return;
      } catch (e: any) {
        if (e?.status === 401) { setUser(null); setIsLoading(false); return; }
        if (attempt < timeouts.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        setUser(null);
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const signIn = (userData: User) => {
    setUser(userData);
  };

  const updateUser = (updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : prev);
  };

  const signOut = async () => {
    try {
      await apiFetch('/api/users/logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout error', e);
    } finally {
      setUser(null);
      router.replace('/(auth)/welcome');
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut, checkAuth, updateUser }}>
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
