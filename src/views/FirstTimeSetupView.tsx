import React, { useState } from 'react';
import { Shield, CheckCircle2, AlertTriangle, ArrowRight, Lock, Mail, Building, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface FirstTimeSetupViewProps {
  onSetupSuccess: () => void;
}

export const FirstTimeSetupView: React.FC<FirstTimeSetupViewProps> = ({ onSetupSuccess }) => {
  const { signIn, refreshAuth } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/setup/initialize-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          password,
          organizationName,
          setupSecret,
        }),
      });

      // Read as text first, then parse. A gateway or platform failure returns
      // plain text rather than JSON, and calling res.json() on it would throw
      // a confusing parse error instead of reporting what actually went wrong.
      const raw = await res.text();
      let data: { error?: string } = {};
      let parsed = true;
      try {
        data = raw ? (JSON.parse(raw) as { error?: string }) : {};
      } catch {
        parsed = false;
        data = {};
      }

      if (!res.ok) {
        // When the body is not JSON it came from the platform rather than from
        // an application handler, so include it verbatim - it is the only
        // clue to what the serverless function actually did.
        const detail = !parsed && raw ? ` Server response: ${raw.slice(0, 300)}` : '';
        throw new Error(
          (data.error ||
            `Provisioning failed (HTTP ${res.status}). The server may be starting up or temporarily unavailable - try again in a moment.`) + detail
        );
      }
      if (!raw) {
        throw new Error('The server returned an empty response. Please try again.');
      }

      setSuccess(true);

      // Attempt immediate sign-in with the new credentials
      const signInRes = await signIn(email, password);
      if (signInRes.error) {
        // Fallback: prompt user to log in
        setTimeout(() => {
          onSetupSuccess();
        }, 2000);
      } else {
        await refreshAuth();
        onSetupSuccess();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Provisioning failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#F5F8FC] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-[#DCE5F0] p-8 text-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-200">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold text-[#172B4D] mb-2">Workspace Initialized</h2>
          <p className="text-sm text-[#65758B] mb-6">
            The initial Super Administrator account and organization workspace have been provisioned securely.
          </p>
          <div className="animate-spin w-6 h-6 border-2 border-[#123B73] border-t-transparent rounded-full mx-auto" />
          <p className="text-xs text-[#65758B] mt-2">Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F8FC] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl border border-[#DCE5F0] overflow-hidden">
        {/* Header */}
        <div className="bg-[#123B73] text-white p-6 sm:p-8 border-b border-[#0B1F3A]">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-[#0B1F3A] border border-blue-400/40">
              <Shield className="w-6 h-6 text-blue-300" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                Sam_Teck <span className="text-blue-300">Hub</span>
              </h1>
              <p className="text-xs text-blue-200 font-medium">First-Time Administrator Setup</p>
            </div>
          </div>
          <p className="text-xs text-blue-100/90 mt-2">
            Establish the primary workspace and provision the initial Super Administrator. Subsequent access requires authorized invitation.
          </p>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4 text-left">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                Administrator Full Name *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#65758B] absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Samuel Techman"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                Administrator Email *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#65758B] absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  placeholder="admin@samteck.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#172B4D] mb-1">
              Secure Password * <span className="text-[10px] text-[#65758B] font-normal">(min 8 characters)</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#65758B] absolute left-3 top-3" />
              <input
                type="password"
                required
                minLength={8}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#172B4D] mb-1">
              Primary Organization / Workspace Name *
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-[#65758B] absolute left-3 top-3" />
              <input
                type="text"
                required
                placeholder="e.g. Sam_Teck Group"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#172B4D] mb-1">
              Setup Provisioning Secret
              <span className="text-[10px] text-[#65758B] font-normal ml-1">
                (Optional if not enforced by server environment)
              </span>
            </label>
            <input
              type="password"
              placeholder="Configured in SETUP_PROVISIONING_SECRET"
              value={setupSecret}
              onChange={(e) => setSetupSecret(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
            />
          </div>

          <div className="pt-3">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg font-semibold text-sm transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  <span>Provisioning Workspace...</span>
                </>
              ) : (
                <>
                  <span>Initialize Super Administrator</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
