import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables for Supabase
const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Allow fallback to session/runtime storage if configured through the in-app setup banner
const runtimeUrl = typeof window !== 'undefined' ? (window as unknown as { __SUPABASE_URL?: string }).__SUPABASE_URL : '';
const runtimeAnonKey = typeof window !== 'undefined' ? (window as unknown as { __SUPABASE_ANON_KEY?: string }).__SUPABASE_ANON_KEY : '';

export const supabaseUrl = envUrl || runtimeUrl || '';
export const supabaseAnonKey = envAnonKey || runtimeAnonKey || '';

export const isSupabaseConfigured = (): boolean => {
  return Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http'));
};

// Create real client with safe dummy credentials if not yet set so the app initializes cleanly
const safeUrl = isSupabaseConfigured() ? supabaseUrl : 'https://placeholder.supabase.co';
const safeKey = isSupabaseConfigured() ? supabaseAnonKey : 'placeholder-anon-key';

export const supabase: SupabaseClient = createClient(safeUrl, safeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Authorization header carrying the caller's live session token.
 *
 * Every request to a protected `/api/*` route must send this: the server
 * derives the caller's identity from the verified token, never from anything
 * in the request body, so a missing header means a 401 rather than a guess.
 */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await supabase.auth.getSession().then((s) => s.data.session?.access_token);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function configureRuntimeSupabase(url: string, key: string) {
  if (typeof window !== 'undefined') {
    (window as unknown as { __SUPABASE_URL: string }).__SUPABASE_URL = url;
    (window as unknown as { __SUPABASE_ANON_KEY: string }).__SUPABASE_ANON_KEY = key;
    localStorage.setItem('STH_RUNTIME_SB_URL', url);
    localStorage.setItem('STH_RUNTIME_SB_KEY', key);
    window.location.reload();
  }
}

// On initial load, restore runtime keys if saved
if (typeof window !== 'undefined') {
  const savedUrl = localStorage.getItem('STH_RUNTIME_SB_URL');
  const savedKey = localStorage.getItem('STH_RUNTIME_SB_KEY');
  if (savedUrl && savedKey && !envUrl) {
    (window as unknown as { __SUPABASE_URL: string }).__SUPABASE_URL = savedUrl;
    (window as unknown as { __SUPABASE_ANON_KEY: string }).__SUPABASE_ANON_KEY = savedKey;
  }
}
