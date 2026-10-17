import React, { useEffect, useState } from 'react';
import { ShieldCheck, Mail, Lock, User, ArrowRight, AlertCircle, Loader2, CheckCircle2, Clock } from 'lucide-react';

interface InviteDetails {
  email: string;
  role: string;
  organizationName: string;
  invitedByName: string;
  expiresAt: string;
}

interface InviteAcceptViewProps {
  token: string;
  onAccepted: () => void;
  onGoToLogin: () => void;
}

const roleLabel = (role: string) => role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const InviteAcceptView: React.FC<InviteAcceptViewProps> = ({ token, onAccepted, onGoToLogin }) => {
  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error || 'This invitation link is not valid.');
        } else {
          setDetails(data);
          // Pre-fill if the address is already recognised server-side.
        }
      } catch {
        if (!cancelled) setLoadError('Could not reach the invitation service. Please try again.');
      } finally {
        if (!cancelled) setLoadingInvite(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!fullName.trim()) {
      setSubmitError('Full name is required.');
      return;
    }
    if (password.length < 8) {
      setSubmitError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Could not complete your account setup.');
        return;
      }
      setDone(true);
      setTimeout(onAccepted, 2200);
    } catch {
      setSubmitError('Network error while setting up your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-[#0B1F3A]">
      {/* Background photograph, shown behind a solid overlay so the white card
          and its text keep contrast whatever the image contains. The base
          colour on the wrapper is the fallback if the file fails to load. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/invite-bg.jpg')" }}
      />
      <div aria-hidden="true" className="absolute inset-0 bg-[#0B1F3A]/70" />

      <div className="relative z-10 max-w-md w-full bg-white rounded-2xl shadow-xl border border-[#DCE5F0] overflow-hidden">
        {/* Brand header */}
        <div className="bg-[#123B73] text-white p-6 sm:p-8 text-center border-b border-[#0B1F3A]">
          <div className="flex items-center justify-center gap-2 mb-1">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <h1 className="text-2xl font-extrabold tracking-tight">
              Sam_Teck <span className="text-blue-300 font-semibold">Hub</span>
            </h1>
          </div>
          <p className="text-xs text-blue-200 mt-1 font-medium">Team Invitation</p>
        </div>

        <div className="p-6 sm:p-8">
          {loadingInvite && (
            <div className="py-10 text-center text-xs text-[#65758B]">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-[#123B73]" />
              Verifying your invitation...
            </div>
          )}

          {!loadingInvite && loadError && (
            <div className="text-center">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2 text-left mb-4">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{loadError}</span>
              </div>
              <button
                onClick={onGoToLogin}
                className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold transition"
              >
                Go to Sign In
              </button>
            </div>
          )}

          {!loadingInvite && !loadError && details && done && (
            <div className="text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h2 className="text-base font-bold text-[#172B4D] mb-1">Account activated!</h2>
              <p className="text-xs text-[#65758B]">Taking you to the sign-in page...</p>
            </div>
          )}

          {!loadingInvite && !loadError && details && !done && (
            <>
              {/* Invitation summary */}
              <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-lg mb-5">
                <div className="flex items-start gap-2.5">
                  <Mail className="w-4 h-4 text-[#123B73] shrink-0 mt-0.5" />
                  <div className="text-xs text-[#172B4D] space-y-1">
                    <p>
                      <span className="font-semibold">{details.invitedByName}</span> invited you to join
                    </p>
                    <p className="font-bold text-sm">{details.organizationName}</p>
                    <p className="text-[#65758B]">
                      as <span className="font-semibold text-[#123B73]">{roleLabel(details.role)}</span>
                    </p>
                    <p className="text-[11px] text-[#65758B] pt-1 flex items-center gap-1 break-all">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {details.email}
                    </p>
                    <p className="text-[10px] text-[#65758B] flex items-center gap-1 pt-0.5">
                      <Clock className="w-3 h-3" />
                      Expires {new Date(details.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 text-left">
                {submitError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{submitError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Full Name *</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#65758B] absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      placeholder="Your full name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#172B4D] mb-1">Create Password *</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#65758B] absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      minLength={8}
                      placeholder="Minimum 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg font-semibold text-sm transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting ? (
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <>
                      <span>Activate My Account</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
