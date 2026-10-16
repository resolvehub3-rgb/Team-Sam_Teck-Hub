import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  Mail,
  Building,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, OrganizationMembership, Department, UserRole } from '../types/database';

export const MembersView: React.FC = () => {
  const { user, organization, role } = useAuth();
  const [members, setMembers] = useState<OrganizationMembership[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Invite Modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('team_member');
  const [inviteDepartmentId, setInviteDepartmentId] = useState('');
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const canManageMembers = role === 'super_admin' || role === 'team_leader' || role === 'assistant_leader';

  const fetchMembersAndDepartments = async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Fetch memberships with profiles
      let memQuery = supabase
        .from('organization_memberships')
        .select('*, profile:profiles(*)')
        .order('created_at', { ascending: true });
      if (organization?.id) {
        memQuery = memQuery.eq('organization_id', organization.id);
      }
      const { data: memData, error: memErr } = await memQuery;
      if (memErr) throw memErr;
      setMembers((memData as OrganizationMembership[]) || []);

      // 2. Fetch departments
      let depQuery = supabase.from('departments').select('*');
      if (organization?.id) {
        depQuery = depQuery.eq('organization_id', organization.id);
      }
      const { data: depData } = await depQuery;
      setDepartments((depData as Department[]) || []);
    } catch (err) {
      console.error('Error fetching members:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembersAndDepartments();
  }, [organization?.id]);

  // Handle Send Invitation
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !user) return;
    setIsSubmittingInvite(true);
    setInviteMessage(null);

    try {
      const orgId = organization?.id || '00000000-0000-0000-0000-000000000000';
      const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      if (isSupabaseConfigured()) {
        const { error } = await supabase.from('invitations').insert({
          organization_id: orgId,
          email: inviteEmail.trim(),
          role: inviteRole,
          department_id: inviteDepartmentId || null,
          invited_by: user.id,
          token,
          expires_at: expiresAt,
        });

        if (error) throw error;
      }

      setInviteMessage(`Invitation successfully registered for ${inviteEmail}.`);
      setInviteEmail('');
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteMessage(null);
      }, 2000);
    } catch (err: unknown) {
      alert('Error sending invitation: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    const name = m.profile?.full_name?.toLowerCase() || '';
    const email = m.profile?.email?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    return name.includes(search) || email.includes(search);
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#172B4D] flex items-center gap-2">
            <Users className="w-5 h-5 text-[#123B73]" />
            Team & Member Management
          </h1>
          <p className="text-xs text-[#65758B] mt-0.5">
            Role assignments, departments, and authorized organization memberships.
          </p>
        </div>

        {canManageMembers && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-3.5 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite Member
          </button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-3.5 rounded-xl border border-[#DCE5F0] shadow-xs flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#65758B] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search members by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:border-[#123B73]"
          />
        </div>
      </div>

      {/* Members Table */}
      <div className="bg-white rounded-xl border border-[#DCE5F0] overflow-hidden shadow-xs">
        {loading ? (
          <div className="py-12 text-center text-xs text-[#65758B]">
            <div className="animate-spin w-5 h-5 border-2 border-[#123B73] border-t-transparent rounded-full mx-auto mb-2" />
            Querying organization members from Supabase...
          </div>
        ) : members.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#65758B]">
            No members found in this workspace.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F5F8FC] border-b border-[#DCE5F0] text-[#65758B] font-semibold">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Skills / Title</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DCE5F0]">
                {filteredMembers.map((m) => (
                  <tr key={m.id} className="hover:bg-[#F5F8FC]/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-[#123B73] text-white flex items-center justify-center font-bold text-xs">
                          {m.profile?.full_name ? m.profile.full_name[0].toUpperCase() : 'U'}
                        </div>
                        <div>
                          <div className="font-semibold text-[#172B4D]">
                            {m.profile?.full_name || 'Member'}
                          </div>
                          <div className="text-[11px] text-[#65758B]">{m.profile?.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-[#123B73] border border-[#DCE5F0]">
                        {m.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#65758B]">
                      {m.profile?.department_id ? 'Assigned' : 'General Workspace'}
                    </td>
                    <td className="px-4 py-3 text-[#65758B]">
                      {m.profile?.job_title || 'Contributor'}
                    </td>
                    <td className="px-4 py-3">
                      {m.is_active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-red-600 font-medium">
                          <XCircle className="w-3.5 h-3.5" /> Suspended
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#65758B]">
                      {new Date(m.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* INVITE MODAL */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-[#DCE5F0] space-y-4">
            <div className="flex items-center justify-between border-b border-[#DCE5F0] pb-3">
              <h2 className="text-base font-bold text-[#172B4D]">Invite Team Member</h2>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-[#65758B] hover:text-[#172B4D]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {inviteMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
                {inviteMessage}
              </div>
            )}

            <form onSubmit={handleSendInvite} className="space-y-3 text-left">
              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  placeholder="colleague@samteck.org"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Authorized Role *
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                >
                  <option value="team_member">Team Member</option>
                  <option value="project_manager">Project Manager</option>
                  <option value="department_lead">Department Lead</option>
                  <option value="assistant_leader">Assistant Team Leader</option>
                  {role === 'super_admin' && <option value="team_leader">Team Leader / Founder</option>}
                  {role === 'super_admin' && <option value="super_admin">Super Administrator</option>}
                  <option value="guest">Authorized Guest</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Department (Optional)
                </label>
                <select
                  value={inviteDepartmentId}
                  onChange={(e) => setInviteDepartmentId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none"
                >
                  <option value="">No Department Assigned</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingInvite}
                  className="px-4 py-2 bg-[#123B73] hover:bg-[#2457A7] text-white text-xs font-semibold rounded-lg transition"
                >
                  {isSubmittingInvite ? 'Issuing Invite...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
