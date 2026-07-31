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
    // On a cold start the first request can time out while the server wakes.
    // A 401 is a definitive "logged out" (stop immediately); any other failure
    // (timeout / network / 5xx) is likely the server waking — retry a few times
    // with backoff so we don't hang forever OR falsely bounce the user to login.
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const data = await apiFetch('/api/users/me', { timeoutMs: 15000 });
        setUser(data);
        setIsLoading(false);
        return;
      } catch (e: any) {
        if (e?.status === 401) { setUser(null); setIsLoading(false); return; }
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, attempt * 1500));
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
