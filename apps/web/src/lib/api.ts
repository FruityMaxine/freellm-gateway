/**
 * Axios + TanStack Query glue.
 *
 * Admin endpoints rely on the session cookie (HttpOnly, Same-Site=Lax) set
 * by `/admin/auth/login`; /v1/* uses a Bearer token from local storage.
 */
import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { QueryClient } from '@tanstack/react-query';

const BEARER_KEY = 'freellm.bearer';

export function getBearer(): string | null {
  try {
    return localStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

export function setBearer(token: string | null): void {
  try {
    if (token) localStorage.setItem(BEARER_KEY, token);
    else localStorage.removeItem(BEARER_KEY);
  } catch {
    /* private mode */
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: '/',
  withCredentials: true,
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  if (config.url?.startsWith('/v1/')) {
    const bearer = getBearer();
    if (bearer) {
      config.headers = config.headers ?? {};
      (config.headers as Record<string, string>)['Authorization'] = `Bearer ${bearer}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ error?: { message?: string; code?: string } }>) => {
    if (err.response?.status === 401) {
      // The component layer decides whether to redirect; the interceptor only flags.
      window.dispatchEvent(new CustomEvent('freellm:unauthorized', { detail: err.response.data }));
    }
    return Promise.reject(err);
  },
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

export type ApiError = {
  status?: number;
  code?: string;
  message: string;
};

export function unwrapError(err: unknown): ApiError {
  const ax = err as AxiosError<{ error?: { message?: string; code?: string } }>;
  return {
    status: ax.response?.status,
    code: ax.response?.data?.error?.code,
    message: ax.response?.data?.error?.message ?? ax.message ?? 'unknown error',
  };
}
