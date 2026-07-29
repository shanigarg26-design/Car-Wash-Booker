import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { apiFetch, ApiError } from '@/api/client';

WebBrowser.maybeCompleteAuthSession();

// EXPO_PUBLIC_API_BASE must be an absolute HTTPS URL so that native Android/iOS
// can call the server. Web uses the same value now — see .env file.
const API_BASE = process.env.EXPO_PUBLIC_API_BASE || '';

export interface GooglePendingProfile {
  name: string;
  email: string;
  accessToken?: string;
  webToken?: string;
}

type SuccessCb = (user: any) => void;
type ErrorCb   = (err: ApiError | Error) => void;
type NewUserCb = (profile: GooglePendingProfile) => void;

// How long after tapping "Continue with Google" we consider a Linking URL
// event valid. Guards against stale deep-link URLs replayed by Expo Go on
// Android relaunch (which previously showed the error banner on app open).
const AUTH_WINDOW_MS = 120_000; // 2 minutes

export function useGoogleAuth(
  onSuccess: SuccessCb,
  onError:   ErrorCb,
  role?: string,
  onNewUser?: NewUserCb,
) {
  const onSuccessRef  = useRef(onSuccess);
  const onErrorRef    = useRef(onError);
  const roleRef       = useRef(role);
  const onNewUserRef  = useRef(onNewUser);
  // Zero = no auth initiated; any Linking/URL event is ignored until
  // promptAsync() is called and sets this to Date.now().
  const authStartedAt = useRef<number>(0);

  useEffect(() => {
    onSuccessRef.current  = onSuccess;
    onErrorRef.current    = onError;
    roleRef.current       = role;
    onNewUserRef.current  = onNewUser;
  });

  // Native deep-link listener.
  // On Android, Chrome Custom Tab closes when the OS intercepts the exp://
  // deep link, so openAuthSessionAsync returns {type:'cancel'} and the real
  // result arrives here via Linking — potentially AFTER promptAsync returns.
  // We therefore only reset authStartedAt inside this handler (not in a
  // finally block), so the timestamp stays valid until we actually handle
  // the URL or the 2-minute window expires.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (!url.includes('auth/google-result')) return;
      const elapsed = Date.now() - authStartedAt.current;
      if (elapsed > AUTH_WINDOW_MS) return; // stale / not initiated by user
      authStartedAt.current = 0; // consume the event
      handleGoogleResultUrl(url, onSuccessRef, onErrorRef, onNewUserRef);
    });
    return () => subscription.remove();
  }, []);

  const promptAsync = async () => {
    if (Platform.OS === 'web') {
      await promptAsyncWeb(roleRef.current, onSuccessRef, onErrorRef, onNewUserRef);
    } else {
      authStartedAt.current = Date.now(); // open the auth window
      await promptAsyncNative(roleRef.current, onSuccessRef, onErrorRef, onNewUserRef);
      // Do NOT reset authStartedAt here — on Android the Linking event
      // arrives after this await returns, so we keep the window open.
    }
  };

  return { request: true, promptAsync };
}

// ── Native flow ───────────────────────────────────────────────────────────────

async function promptAsyncNative(
  role:         string | undefined,
  onSuccessRef: React.MutableRefObject<SuccessCb>,
  onErrorRef:   React.MutableRefObject<ErrorCb>,
  onNewUserRef: React.MutableRefObject<NewUserCb | undefined>,
): Promise<void> {
  const returnUrl = Linking.createURL('auth/google-result');
  const initUrl   = `${API_BASE}/api/auth/google/init?role=${encodeURIComponent(role || 'login')}&return_url=${encodeURIComponent(returnUrl)}`;

  if (!API_BASE) {
    onErrorRef.current(new Error('App configuration error: API_BASE is not set. Please restart the app.'));
    return;
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(
      initUrl,
      returnUrl,
      { showInRecents: true },
    );
    if (result.type === 'success' && result.url) {
      // iOS: ASWebAuthenticationSession intercepts the URL directly.
      await handleGoogleResultUrl(result.url, onSuccessRef, onErrorRef, onNewUserRef);
    }
    // 'cancel' / 'dismiss': on Android this is the normal path — the OS
    // redirects to Expo Go via the Linking listener above, not here.
  } catch (e: any) {
    onErrorRef.current(new Error(`Could not open the sign-in browser: ${e?.message || 'unknown error'}. Please try again.`));
  }
}

// ── Web flow ──────────────────────────────────────────────────────────────────
// The app may run inside a Replit iframe where window.open() is sandboxed.
// Strategy:
//   1. Try a named popup window (standard OAuth popup flow).
//   2. If that's blocked, fall back to a _blank tab — it still has
//      window.opener set, so the server's postMessage reaches us.
//   3. If both are blocked, surface an actionable error message.

async function promptAsyncWeb(
  role:         string | undefined,
  onSuccessRef: React.MutableRefObject<SuccessCb>,
  onErrorRef:   React.MutableRefObject<ErrorCb>,
  onNewUserRef: React.MutableRefObject<NewUserCb | undefined>,
): Promise<void> {
  const initUrl = `${API_BASE}/api/auth/google/init?role=${encodeURIComponent(role || 'login')}&platform=web`;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };

    const onMessage = async (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'carcleanpro-google-auth') return;
      window.removeEventListener('message', onMessage as EventListener);
      clearInterval(closedPoll);
      await processResult(event.data, onSuccessRef, onErrorRef, onNewUserRef);
      finish();
    };

    window.addEventListener('message', onMessage as EventListener);

    // Try popup first, then fall back to a new tab (which still has opener).
    let popup: Window | null =
      window.open(initUrl, 'carcleanpro-google-auth', 'width=520,height=640,scrollbars=yes,resizable=yes');

    if (!popup) {
      popup = window.open(initUrl, '_blank');
    }

    if (!popup) {
      window.removeEventListener('message', onMessage as EventListener);
      onErrorRef.current(new Error(
        'Sign-in window was blocked by your browser.\n' +
        'Please allow pop-ups for this site in your browser settings, then try again.\n' +
        `Or open this URL directly:\n${initUrl}`
      ));
      finish();
      return;
    }

    const closedPoll = setInterval(() => {
      try {
        if (popup && popup.closed && !resolved) {
          clearInterval(closedPoll);
          window.removeEventListener('message', onMessage as EventListener);
          finish();
        }
      } catch {
        clearInterval(closedPoll);
        finish();
      }
    }, 500);
  });
}

// ── Shared result processors ──────────────────────────────────────────────────

async function processResult(
  data:         Record<string, string>,
  onSuccessRef: React.MutableRefObject<SuccessCb>,
  onErrorRef:   React.MutableRefObject<ErrorCb>,
  onNewUserRef: React.MutableRefObject<NewUserCb | undefined>,
) {
  const { token, status, error } = data;

  if (error) {
    if (error === 'cancelled') return;
    if (error === 'email_registered_via_phone') {
      onErrorRef.current(new ApiError(
        'This email is already registered using a Phone Number. Please log in with your phone number.',
        'email_registered_via_phone',
        409,
      ));
    } else {
      onErrorRef.current(new Error(`Google sign-in failed (${error}). Please try again.`));
    }
    return;
  }

  if (status === 'new' && token) {
    if (onNewUserRef.current) {
      try {
        const profile = await apiFetch(`/api/auth/google/pending?token=${encodeURIComponent(token)}`);
        onNewUserRef.current({ name: profile.name, email: profile.email, webToken: token });
      } catch {
        onErrorRef.current(new Error('Failed to retrieve Google profile. Please try again.'));
      }
    } else {
      onErrorRef.current(new ApiError(
        'No account found for this Google address. Please sign up first.',
        'not_registered',
        404,
      ));
    }
    return;
  }

  if (!token) return;

  try {
    const user = await apiFetch(`/api/auth/google/session?token=${encodeURIComponent(token)}`);
    onSuccessRef.current(user);
  } catch (e) {
    onErrorRef.current(e instanceof ApiError ? e : new Error('Failed to complete Google sign-in. Please try again.'));
  }
}

async function handleGoogleResultUrl(
  url:          string,
  onSuccessRef: React.MutableRefObject<SuccessCb>,
  onErrorRef:   React.MutableRefObject<ErrorCb>,
  onNewUserRef: React.MutableRefObject<NewUserCb | undefined>,
) {
  if (!url.includes('auth/google-result')) return;
  const qIndex = url.indexOf('?');
  const qs = qIndex >= 0 ? url.slice(qIndex + 1) : '';
  const data: Record<string, string> = {};
  new URLSearchParams(qs).forEach((v, k) => { data[k] = v; });
  await processResult(data, onSuccessRef, onErrorRef, onNewUserRef);
}
