import React, { useState, useEffect, useRef } from 'react';
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
  X,
  Trash2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured, getAuthHeader } from '../lib/supabase';
import { Profile, OrganizationMembership, Department, UserRole } from '../types/database';

interface PendingInvitation {
  id: string;
  email: string;
  role: UserRole;
  is_accepted: boolean;
  expires_at: string;
  created_at: string;
}

export const MembersView: React.FC = () => {
  const { user, organization, role, profile } = useAuth();
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
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvitation[]>([]);

  // Removal flow. The typed email is the confirmation; the server re-checks it
  // against the database, so a tampered request cannot bypass it.
  const [removeTarget, setRemoveTarget] = useState<OrganizationMembership | null>(null);
  const [removeConfirmEmail, setRemoveConfirmEmail] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);

  // Guards the cleanup effect so a subscription is only torn down once.
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

      // 3. Fetch outstanding invitations so admins can see what is pending.
      //    NOTE: the secret token is deliberately NOT selected here — the
      //    link is fetched separately from the server, which authorises it.
      const { data: invData } = await supabase
        .from('invitations')
        .select('id, email, role, is_accepted, expires_at, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      setPendingInvites((invData as PendingInvitation[]) || []);
    } catch (err) {
      console.error('Error fetching members:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembersAndDepartments();
  }, [organization?.id]);

  // Live roster. When a leader removes someone, every other open Team &
  // Members screen drops that row without a refresh. The delete is performed
  // by the server with the service role, so it does not depend on the client
  // holding a delete policy — this subscription only reports what happened.
  useEffect(() => {
    if (!isSupabaseConfigured() || !organization?.id || !user) return;

    const orgId = organization.id;
    const channelName = `members-roster-${orgId}-${user.id}`;
    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    const handleChange = () => {
      // Re-read from the database rather than guessing at the payload: the
      // source of truth stays the table, and this cannot drift out of sync.
      fetchMembersAndDepartments();
    };

    channel
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'organization_memberships', filter: `organization_id=eq.${orgId}` }, handleChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'organization_memberships', filter: `organization_id=eq.${orgId}` }, handleChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'organization_memberships', filter: `organization_id=eq.${orgId}` }, handleChange)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id, user?.id]);

  const copyInviteLink = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(key);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // Clipboard can be blocked; surface the link so it can be copied manually.
      window.prompt('Copy this invitation link:', url);
    }
  };

  // The invite token is secret, so it is not stored client-side. Fetch the
  // link from the server on demand (authorised by the caller's JWT).
  const fetchInviteLink = async (invitationId: string) => {
    const token = await supabase.auth.getSession().then((s) => s.data.session?.access_token);
    const res = await fetch(`/api/invitations/${invitationId}/link`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not retrieve the invitation link.');
    return data.inviteUrl as string;
  };

  // Handle Send Invitation
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !user) return;

    setIsSubmittingInvite(true);
    setInviteMessage(null);
    setInviteError(null);
    setLastInviteUrl(null);

    try {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase is not configured, so invitations cannot be issued.');
      }
      if (!organization?.id) {
        throw new Error('Your account is not linked to an organization, so the invitation cannot be issued.');
      }

      const sessionToken = await supabase.auth.getSession().then((s) => s.data.session?.access_token);
      if (!sessionToken) {
        throw new Error('Your session has expired. Sign in again and retry the invitation.');
      }

      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({
          email,
          role: inviteRole,
          departmentId: inviteDepartmentId || null,
          organizationId: organization.id,
          invitedById: user.id,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Invite request failed with status ${res.status}.`);
      }

      // Only report success once the server confirms delivery.
      setInviteMessage(data.message || `Invitation sent to ${email}.`);
      setLastInviteUrl(data.inviteUrl || null);
      setInviteEmail('');
      setInviteDepartmentId('');
      fetchMembersAndDepartments();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : err instanceof Error
            ? err.message
            : 'Unknown error';
      setInviteError('Failed to send invitation: ' + msg);
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  // Removing a member is irreversible. The server enforces every rule —
  // self-removal, seniority, email confirmation — so this handler only sends
  // the request and reports exactly what came back.
  const openRemoveModal = (m: OrganizationMembership) => {
    setRemoveTarget(m);
    setRemoveConfirmEmail('');
    setRemoveError(null);
    setRemoveMessage(null);
  };

  const closeRemoveModal = () => {
    if (isRemoving) return;
    setRemoveTarget(null);
    setRemoveConfirmEmail('');
    setRemoveError(null);
  };

  const handleRemoveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!removeTarget) return;

    setIsRemoving(true);
    setRemoveError(null);

    try {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase is not configured, so a member cannot be removed.');
      }

      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) {
        throw new Error('Your session has expired. Sign in again and retry.');
      }

      const res = await fetch(`/api/members/${removeTarget.user_id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ confirmEmail: removeConfirmEmail.trim() }),
      });

      const data: {
        success?: boolean;
        removedName?: string;
        removedEmail?: string;
        preservedRecords?: Record<string, number>;
        auditRecorded?: boolean;
        error?: string;
      } = await res.json().catch(() => ({ error: 'No response was received from the server.' }));

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Removal failed with status ${res.status}.`);
      }

      const preservedCount = Object.values(data.preservedRecords || {}).reduce((a, b) => a + b, 0);
      setRemoveMessage(
        `${data.removedName || data.removedEmail || 'The member'} was removed.` +
          (preservedCount > 0
            ? ` ${preservedCount} record${preservedCount === 1 ? '' : 's'} they created remain${preservedCount === 1 ? 's' : ''} in the workspace under "Former member".`
            : ' No records were attributed to them.') +
          (data.auditRecorded === false ? ' The audit entry could not be written.' : '')
      );
      setRemoveTarget(null);
      setRemoveConfirmEmail('');
      // The realtime subscription also refreshes this; doing it here means the
      // row disappears even if that subscription is unavailable.
      fetchMembersAndDepartments();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : 'The member could not be removed. Nothing was changed.';
      setRemoveError(msg);
    } finally {
      setIsRemoving(false);
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

      {/* Removal result — only shown once the server has confirmed the change */}
      {removeMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <p className="text-xs text-emerald-800">{removeMessage}</p>
          </div>
          <button
            onClick={() => setRemoveMessage(null)}
            aria-label="Dismiss removal confirmation"
            className="text-emerald-600 hover:text-emerald-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
                  {canManageMembers && <th className="px-4 py-3 text-right">Actions</th>}
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
                    {canManageMembers && (
                      <td className="px-4 py-3 text-right">
                        {m.user_id === user?.id ? (
                          // Removing yourself is refused by the server too;
                          // the row is simply not offered.
                          <span className="text-[11px] text-[#94A3B8]">Your account</span>
                        ) : (
                          <button
                            onClick={() => openRemoveModal(m)}
                            aria-label={`Remove ${m.profile?.full_name || m.profile?.email || 'member'}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PENDING INVITATIONS */}
      {canManageMembers && pendingInvites.length > 0 && (
        <div className="bg-white rounded-xl border border-[#DCE5F0] overflow-hidden shadow-xs">
          <div className="px-4 py-3 bg-[#F5F8FC] border-b border-[#DCE5F0] flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#123B73]" />
            <h3 className="text-xs font-bold text-[#172B4D]">Pending Invitations ({pendingInvites.length})</h3>
          </div>
          <div className="divide-y divide-[#DCE5F0]">
            {pendingInvites.map((inv) => {
              const expired = new Date(inv.expires_at).getTime() < Date.now();
              return (
                <div key={inv.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#172B4D] truncate">{inv.email}</div>
                    <div className="text-[11px] text-[#65758B] flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#123B73] font-medium uppercase text-[10px] tracking-wider">
                        {inv.role.replace('_', ' ')}
                      </span>
                      <span>
                        {inv.is_accepted
                          ? 'Accepted'
                          : expired
                            ? 'Expired'
                            : `Expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                      </span>
                    </div>
                  </div>
                  {!inv.is_accepted && !expired && (
                    <button
                      onClick={async () => {
                        try {
                          const url = await fetchInviteLink(inv.id);
                          await copyInviteLink(url, inv.id);
                        } catch (err) {
                          setInviteError(
                            err instanceof Error ? err.message : 'Could not retrieve the invitation link.'
                          );
                        }
                      }}
                      className="px-2.5 py-1.5 border border-[#DCE5F0] text-[#123B73] hover:bg-slate-50 text-[11px] font-semibold rounded-lg transition shrink-0"
                    >
                      {copiedToken === inv.id ? 'Copied!' : 'Copy Link'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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

            {inviteError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {inviteError}
              </div>
            )}

            {inviteMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 space-y-2">
                <div>{inviteMessage}</div>
                {lastInviteUrl && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      readOnly
                      value={lastInviteUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 px-2 py-1.5 text-[11px] font-mono border border-emerald-200 rounded bg-white text-[#172B4D] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => copyInviteLink(lastInviteUrl, 'modal')}
                      className="px-2.5 py-1.5 bg-[#123B73] hover:bg-[#2457A7] text-white text-[11px] font-semibold rounded transition shrink-0"
                    >
                      {copiedToken === 'modal' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}
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
                  {isSubmittingInvite ? (
                    <span className="flex items-center gap-1.5">
                      <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                      Sending Invite...
                    </span>
                  ) : (
                    'Send Invitation'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Member Confirmation */}
      {removeTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#172B4D] flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-600" />
                Remove Member
              </h3>
              <button
                onClick={closeRemoveModal}
                disabled={isRemoving}
                aria-label="Close removal dialog"
                className="text-[#65758B] hover:text-[#172B4D] disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 space-y-2">
              <p className="text-xs text-red-800">
                <span className="font-semibold">{removeTarget.profile?.full_name || 'This member'}</span>{' '}
                (<span className="font-mono">{removeTarget.profile?.email}</span>) will lose access
                immediately and their account will be deleted. This cannot be undone.
              </p>
              <p className="text-[11px] text-red-700">
                Work they created is kept and re-attributed to &ldquo;Former member&rdquo;. Anything
                personal to them — notifications, votes, participation — is deleted with the account.
              </p>
            </div>

            <form onSubmit={handleRemoveMember} className="space-y-3">
              <div>
                <label htmlFor="remove-confirm-email" className="block text-xs font-semibold text-[#172B4D] mb-1">
                  Type <span className="font-mono">{removeTarget.profile?.email}</span> to confirm
                </label>
                <input
                  id="remove-confirm-email"
                  type="text"
                  autoComplete="off"
                  value={removeConfirmEmail}
                  onChange={(e) => setRemoveConfirmEmail(e.target.value)}
                  placeholder={removeTarget.profile?.email || ''}
                  disabled={isRemoving}
                  className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:border-red-500 disabled:bg-slate-50"
                />
              </div>

              {removeError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 flex items-start gap-2">
                  <XCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-red-700">{removeError}</p>
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-[#DCE5F0]">
                <button
                  type="button"
                  onClick={closeRemoveModal}
                  disabled={isRemoving}
                  className="px-4 py-2 border border-[#DCE5F0] text-xs font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRemoving || removeConfirmEmail.trim().toLowerCase() !== (removeTarget.profile?.email || '').toLowerCase()}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRemoving ? (
                    <span className="flex items-center gap-1.5">
                      <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                      Removing...
                    </span>
                  ) : (
                    'Remove Member'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
