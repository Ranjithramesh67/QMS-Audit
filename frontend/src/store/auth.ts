import { create } from 'zustand';
import { api, tokenStore } from '@/lib/api';

/** Role code, e.g. ADMIN / QMR / a custom role code. Kept as a string for display. */
export type Role = string;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  roleId: string;
  roleName?: string;
  permissions: string[];
  designation?: string | null;
  plant?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
}

interface AuthState {
  user: AuthUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
  /** True when the user holds at least one of the given permission keys (or full access). */
  can: (...permissions: string[]) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: 'idle',
  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    tokenStore.set(data.token);
    set({ user: data.user, status: 'authenticated' });
  },
  logout: () => {
    tokenStore.clear();
    set({ user: null, status: 'unauthenticated' });
  },
  hydrate: async () => {
    if (!tokenStore.get()) {
      set({ status: 'unauthenticated' });
      return;
    }
    set({ status: 'loading' });
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data, status: 'authenticated' });
    } catch {
      tokenStore.clear();
      set({ user: null, status: 'unauthenticated' });
    }
  },
  can: (...permissions) => {
    const held = get().user?.permissions;
    if (!held || held.length === 0) return false;
    if (held.includes('*')) return true;
    if (permissions.length === 0) return true;
    return permissions.some((key) => held.includes(key));
  },
}));

/** Non-hook helper for permission checks outside components. */
export function can(permissions: string[] | undefined, ...required: string[]): boolean {
  if (!permissions || permissions.length === 0) return false;
  if (permissions.includes('*')) return true;
  if (required.length === 0) return true;
  return required.some((key) => permissions.includes(key));
}
