import { create } from 'zustand';
import type {
  AuthResponse,
  AuthUserDto,
  LoginDto,
  SignupDto,
} from '@opspilot/types';
import { authApi, refreshSession, setAccessToken } from './api';

type AuthStatus = 'unknown' | 'authenticated' | 'guest';

interface AuthState {
  status: AuthStatus;
  user: AuthUserDto | null;
  setSession: (session: AuthResponse) => void;
  setGuest: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,
  setSession: (session) => {
    setAccessToken(session.accessToken);
    set({ status: 'authenticated', user: session.user });
  },
  setGuest: () => {
    setAccessToken(null);
    set({ status: 'guest', user: null });
  },
}));

export async function login(dto: LoginDto): Promise<void> {
  const session = await authApi<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(dto),
    credentials: 'include', // receive the refresh cookie
  });
  useAuth.getState().setSession(session);
}

export async function signup(dto: SignupDto): Promise<void> {
  const session = await authApi<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(dto),
    credentials: 'include',
  });
  useAuth.getState().setSession(session);
}

/** Never throws: the local session always ends, even if revocation fails. */
export async function logout(): Promise<void> {
  try {
    await authApi<void>('/auth/logout', {
      method: 'POST',
      credentials: 'include', // send the cookie so the server can revoke it
    });
  } catch {
    // API unreachable — the httpOnly cookie expires on its own TTL; the
    // in-memory session is cleared below either way.
  } finally {
    useAuth.getState().setGuest();
  }
}

/** Re-establish the session after a full page load via the refresh cookie. */
export async function bootstrapSession(): Promise<void> {
  const session = await refreshSession();
  if (session) useAuth.getState().setSession(session);
  else useAuth.getState().setGuest();
}
