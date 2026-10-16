import React, { useState } from 'react';
import { Lock, Mail, ArrowRight, AlertCircle, Shield, UserPlus, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface LoginViewProps {
  onGoToSetup?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onGoToSetup }) => {
  const { signIn, signUp, systemSetupStatus } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (isRegistering) {
        if (!fullName.trim()) {
          throw new Error('Full name is required for registration.');
        }
        const res = await signUp(email, password, fullName);
        if (res.error) {
          throw new Error(res.error);
        }
        setMessage('Registration successful! Please check your email for confirmation if required, or sign in.');
      } else {
        const res = await signIn(email, password);
        if (res.error) {
          throw new Error(res.error);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F8FC] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-[#DCE5F0] overflow-hidden">
        {/* Brand header */}
        <div className="bg-[#123B73] text-white p-6 sm:p-8 text-center border-b border-[#0B1F3A]">
          <div className="flex items-center justify-center gap-2 mb-1">
            <h1 className="text-2xl font-extrabold tracking-tight">
              Sam_Teck <span className="text-blue-300 font-semibold">Hub</span>
            </h1>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#0B1F3A] text-blue-200 border border-blue-400/20">
              SAAS
            </span>
          </div>
          <p className="text-xs text-blue-200 mt-1 font-medium">
            Production Workspace & Virtual Meetings
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-[#DCE5F0] text-xs font-semibold">
          <button
            onClick={() => {
              setIsRegistering(false);
              setError(null);
              setMessage(null);
            }}
            className={`flex-1 py-3 text-center transition flex items-center justify-center gap-1.5 ${
              !isRegistering
                ? 'text-[#123B73] border-b-2 border-[#123B73] bg-blue-50/40'
                : 'text-[#65758B] hover:text-[#172B4D]'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
          <button
            onClick={() => {
              setIsRegistering(true);
              setError(null);
              setMessage(null);
            }}
            className={`flex-1 py-3 text-center transition flex items-center justify-center gap-1.5 ${
              isRegistering
                ? 'text-[#123B73] border-b-2 border-[#123B73] bg-blue-50/40'
                : 'text-[#65758B] hover:text-[#172B4D]'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Activate / Register
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4 text-left">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {message && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
              {message}
            </div>
          )}

          {isRegistering && (
            <div>
              <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#172B4D] mb-1">
              Email Address *
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#65758B] absolute left-3 top-3" />
              <input
                type="email"
                required
                placeholder="user@samteck.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#172B4D] mb-1">
              Password *
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

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg font-semibold text-sm transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <>
                  <span>{isRegistering ? 'Create Account' : 'Sign In to Workspace'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* First time admin setup trigger */}
          {systemSetupStatus.canSetup && onGoToSetup && (
            <div className="pt-4 border-t border-[#DCE5F0] text-center">
              <p className="text-xs text-[#65758B] mb-1.5">First time setting up this platform?</p>
              <button
                type="button"
                onClick={onGoToSetup}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#123B73] hover:text-[#2457A7]"
              >
                <Shield className="w-3.5 h-3.5" />
                Launch First-Time Administrator Provisioning
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
