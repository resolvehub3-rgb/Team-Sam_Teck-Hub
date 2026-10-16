/**
 * Shared presentation helpers for Sam_Teck Hub.
 *
 * Supabase/PostgREST errors are plain objects rather than Error instances,
 * so `err instanceof Error` is always false and the real message is lost.
 * Every surface in the Member Workspace routes through these helpers so a
 * failure is always explained rather than swallowed.
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; error_description?: unknown; hint?: unknown };
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
    if (typeof e.error_description === 'string' && e.error_description.trim()) return e.error_description;
    if (typeof e.hint === 'string' && e.hint.trim()) return e.hint;
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

/** RLS / permission failures get a member-friendly explanation. */
export function describeAccessError(err: unknown): string {
  const msg = getErrorMessage(err, '');
  const lower = msg.toLowerCase();
  if (lower.includes('permission') || lower.includes('row-level') || lower.includes('policy')) {
    return 'You do not have permission to do that. Ask a workspace administrator if you believe this is wrong.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Could not reach the Sam_Teck Hub service. Check your connection and try again.';
  }
  return msg || 'The request could not be completed.';
}

/** Formats bytes for file listings without inventing precision. */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Safe date rendering — never shows "Invalid Date". */
export function formatDate(value?: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], opts ?? { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative time such as "3h ago" / "in 2d"; returns a plain date when > 7 days out. */
export function formatRelativeTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const diffMs = d.getTime() - Date.now();
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absMin < 60) return rtf.format(Math.round(diffMs / 60000), 'minute');
  const absHours = Math.round(absMin / 60);
  if (absHours < 24) return rtf.format(Math.round(diffMs / 3600000), 'hour');
  const absDays = Math.round(absHours / 24);
  if (absDays <= 7) return rtf.format(Math.round(diffMs / 86400000), 'day');
  return formatDate(value);
}

/** Initials for the avatar chip; never returns an empty string. */
export function initialsOf(name?: string | null, fallback = 'U'): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return fallback;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
