import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Check, Database, Server, ExternalLink } from 'lucide-react';
import { isSupabaseConfigured, configureRuntimeSupabase } from '../lib/supabase';

export const SetupBanner: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState('');
  const [copiedMigration, setCopiedMigration] = useState(false);
  const configured = isSupabaseConfigured();

  const handleSaveRuntimeConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseUrlInput.trim() || !supabaseKeyInput.trim()) return;
    configureRuntimeSupabase(supabaseUrlInput.trim(), supabaseKeyInput.trim());
  };

  const copyMigrationPath = () => {
    navigator.clipboard.writeText('/supabase/migrations/20261016000000_sam_teck_hub_schema.sql');
    setCopiedMigration(true);
    setTimeout(() => setCopiedMigration(false), 2000);
  };

  if (configured && !isOpen) {
    return null;
  }

  return (
    <div className="bg-[#0B1F3A] text-white border-b border-[#2457A7] px-4 py-2.5 shadow-sm text-sm">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {configured ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span className="font-medium">
            {configured
              ? 'Supabase Backend Connected'
              : 'Supabase Database Configuration Required'}
          </span>
          <span className="text-xs text-blue-200 hidden sm:inline">
            {configured
              ? 'Real-time database and auth active'
              : 'Add credentials to .env or configure in runtime for real database persistence'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="px-3 py-1 bg-[#123B73] hover:bg-[#2457A7] text-white rounded text-xs font-semibold transition flex items-center gap-1.5"
          >
            <Database className="w-3.5 h-3.5" />
            {isOpen ? 'Close Config' : 'Database Setup'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="max-w-7xl mx-auto mt-4 pt-3 border-t border-[#123B73]/60 grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
          <div className="bg-[#123B73]/40 p-4 rounded-lg border border-[#2457A7]/40">
            <h4 className="font-semibold text-white flex items-center gap-2 mb-2">
              <Server className="w-4 h-4 text-blue-400" />
              Runtime Supabase Connection
            </h4>
            <p className="text-xs text-blue-100 mb-3">
              Enter your project URL and anon key to connect immediately, or configure <code className="bg-[#0B1F3A] px-1 py-0.5 rounded text-amber-300">VITE_SUPABASE_URL</code> in your <code className="bg-[#0B1F3A] px-1 py-0.5 rounded text-amber-300">.env</code> file.
            </p>
            <form onSubmit={handleSaveRuntimeConfig} className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-medium text-blue-200 uppercase tracking-wider mb-1">
                  Supabase Project URL
                </label>
                <input
                  type="text"
                  placeholder="https://xyzcompany.supabase.co"
                  value={supabaseUrlInput}
                  onChange={(e) => setSupabaseUrlInput(e.target.value)}
                  className="w-full bg-[#0B1F3A] border border-[#2457A7] rounded px-2.5 py-1.5 text-xs text-white placeholder-blue-300/40 focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-blue-200 uppercase tracking-wider mb-1">
                  Supabase Anon Public Key
                </label>
                <input
                  type="password"
                  placeholder="eyJhbGciOi..."
                  value={supabaseKeyInput}
                  onChange={(e) => setSupabaseKeyInput(e.target.value)}
                  className="w-full bg-[#0B1F3A] border border-[#2457A7] rounded px-2.5 py-1.5 text-xs text-white placeholder-blue-300/40 focus:outline-none focus:border-blue-400"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-[#2457A7] hover:bg-blue-600 text-white font-medium py-1.5 rounded text-xs transition"
              >
                Apply Supabase Credentials
              </button>
            </form>
          </div>

          <div className="bg-[#123B73]/40 p-4 rounded-lg border border-[#2457A7]/40 flex flex-col justify-between">
            <div>
              <h4 className="font-semibold text-white flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-emerald-400" />
                PostgreSQL Schema Migration
              </h4>
              <p className="text-xs text-blue-100 mb-2">
                The migration script includes all 39 entities, constraints, foreign keys, and Row Level Security (RLS) policies.
              </p>
              <div className="bg-[#0B1F3A] p-2.5 rounded text-xs font-mono text-blue-200 border border-[#2457A7]/50 mb-3 flex items-center justify-between">
                <span className="truncate">supabase/migrations/20261016000000_sam_teck_hub_schema.sql</span>
                <button
                  onClick={copyMigrationPath}
                  className="ml-2 text-xs bg-[#123B73] hover:bg-[#2457A7] px-2 py-1 rounded text-white flex items-center gap-1 shrink-0"
                  title="Copy migration file path"
                >
                  {copiedMigration ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedMigration ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="text-[11px] text-blue-200/80">
              Run this SQL script in your Supabase SQL Editor to provision all tables, enums, triggers, and RLS policies.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
