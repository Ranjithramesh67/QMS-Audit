import axios, { AxiosError } from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 30000 });

const TOKEN_KEY = 'qms.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: { message?: string; details?: unknown } }>) => {
    if (error.response?.status === 401) {
      tokenStore.clear();
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export function apiError(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Thin helpers over axios for the common REST resource shape. */
export const resources = {
  list: <T>(path: string, params?: Record<string, unknown>) =>
    api.get<Paginated<T>>(path, { params }).then((r) => r.data),
  // Some list endpoints return a bare array, others a paginated envelope
  // ({ items, total, ... }). Normalise both to a plain array for callers.
  all: <T>(path: string, params?: Record<string, unknown>) =>
    api.get<Paginated<T> | T[]>(path, { params }).then((r) => {
      const data = r.data as unknown;
      if (Array.isArray(data)) return data as T[];
      if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
        return (data as Paginated<T>).items;
      }
      return [] as T[];
    }),
  get: <T>(path: string) => api.get<T>(path).then((r) => r.data),
  create: <T>(path: string, body: unknown) => api.post<T>(path, body).then((r) => r.data),
  update: <T>(path: string, body: unknown) => api.put<T>(path, body).then((r) => r.data),
  remove: (path: string) => api.delete(path).then((r) => r.data),
};
