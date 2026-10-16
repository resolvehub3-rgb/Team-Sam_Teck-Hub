import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Server,
  Database,
  Video,
  FileText,
  Clock,
  User,
  AlertCircle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AuditLogItem } from '../types/database';

export const AdminView: React.FC = () => {
  const { role, user } = useAuth();
  const [healthStatus, setHealthStatus] = useState<Record<string, any> | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      // 1. Health endpoint
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealthStatus(data);
      }

      // 2. Audit logs from Supabase
      if (isSupabaseConfigured()) {
        const { data: logs, error } = await supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20);

        if (!error && logs) {
          setAuditLogs(logs as AuditLogItem[]);
        }
      }
    } catch (err) {
      console.warn('Error loading admin status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#123B73]" />
            Administration & Governance Panel
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            System configuration, integration health, security policies, and immutable audit logs.
          </p>
        </div>

        <button
          onClick={fetchAdminData}
          className="px-3.5 py-2 bg-[#F5F8FC] hover:bg-[#DCE5F0] text-[#172B4D] border border-[#DCE5F0] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {/* Integration Health Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Database Status */}
        <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#172B4D] flex items-center gap-1.5">
              <Database className="w-4 h-4 text-[#123B73]" />
              Supabase PostgreSQL
            </span>
            {healthStatus?.database?.configured ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Connected
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                Pending Config
              </span>
            )}
          </div>
          <p className="text-xs text-[#65758B]">
            {healthStatus?.database?.configured
              ? 'PostgreSQL RLS, Auth, and Realtime active.'
              : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.'}
          </p>
        </div>

        {/* LiveKit Cloud Status */}
        <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#172B4D] flex items-center gap-1.5">
              <Video className="w-4 h-4 text-emerald-600" />
              LiveKit Cloud WebRTC
            </span>
            {healthStatus?.livekit?.configured ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Operational
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                Local Device Mode
              </span>
            )}
          </div>
          <p className="text-xs text-[#65758B]">
            {healthStatus?.livekit?.configured
              ? 'WebRTC SFU room token generator active.'
              : 'Local audio/video preview active. Add LIVEKIT_API_KEY for multi-party SFU.'}
          </p>
        </div>

        {/* Security & Setup Secret */}
        <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#172B4D] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-purple-600" />
              Admin Provisioning
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              Provisioned
            </span>
          </div>
          <p className="text-xs text-[#65758B]">
            First-time super-administrator has been established. First-run setup route closed.
          </p>
        </div>
      </div>

      {/* Audit Log Viewer */}
      <div className="bg-white rounded-xl border border-[#DCE5F0] p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#DCE5F0]">
          <div>
            <h2 className="text-sm font-bold text-[#172B4D] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#123B73]" />
              Immutable Audit Log
            </h2>
            <p className="text-xs text-[#65758B]">
              Tracks administrative actions, provisioning, role shifts, and security events.
            </p>
          </div>
        </div>

        {auditLogs.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#65758B]">
            No audit events recorded yet. System activities will be logged here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F5F8FC] border-b border-[#DCE5F0] text-[#65758B] font-semibold">
                <tr>
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Actor</th>
                  <th className="px-4 py-2.5">Target Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DCE5F0]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#F5F8FC]/50">
                    <td className="px-4 py-2.5 text-[#65758B] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-[#172B4D]">
                      <span className="font-mono bg-blue-50 text-[#123B73] px-2 py-0.5 rounded border border-[#DCE5F0]">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#172B4D]">
                      {log.user_email || 'System Process'}
                    </td>
                    <td className="px-4 py-2.5 text-[#65758B] capitalize">
                      {log.target_entity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
