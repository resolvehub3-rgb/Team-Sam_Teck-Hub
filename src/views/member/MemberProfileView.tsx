import React, { useCallback, useEffect, useState } from 'react';
import {
  UserCircle2,
  Save,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Department } from '../../types/database';
import { checkRolePermission } from '../../utils/rules';
import { describeAccessError, formatDate, initialsOf } from '../../utils/format';
import { Chip, ErrorState, LoadingState, PageHeader, SectionCard, buttonStyles } from '../../components/ui';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Profile & security settings for the signed-in member.
 *
 * The role, organisation membership and suspension state are deliberately
 * read-only: they live in organization_memberships / profiles and the
 * database refuses changes to them from a non-leadership caller.
 */
export const MemberProfileView: React.FC = () => {
  const { user, profile, role, organization, refreshAuth } = useAuth();

  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [bio, setBio] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [department, setDepartment] = useState<Department | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  // Seed the editable fields once the profile arrives.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name || '');
    setJobTitle(profile.job_title || '');
    setBio(profile.bio || '');
    setSkillsText((profile.skills || []).join(', '));
    setAvatarUrl(profile.avatar_url || '');
  }, [profile?.id, profile?.full_name, profile?.job_title, profile?.bio, profile?.avatar_url]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !profile?.department_id) {
      setDepartment(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('departments')
      .select('*')
      .eq('id', profile.department_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDepartment((data as Department) || null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.department_id]);

  const saveProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user || !profile) return;
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(null);

      try {
        const payload = {
          full_name: fullName.trim() || profile.full_name,
          job_title: jobTitle.trim() || null,
          bio: bio.trim() || null,
          avatar_url: avatarUrl.trim() || null,
          skills: skillsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          updated_at: new Date().toISOString(),
        };

        const { error: err } = await supabase.from('profiles').update(payload).eq('id', user.id);
        if (err) throw err;

        // Keep the auth record's display metadata in step with the profile.
        const { error: authErr } = await supabase.auth.updateUser({
          data: { full_name: payload.full_name },
        });
        if (authErr) throw authErr;

        setSaveSuccess('Your profile has been saved.');
        await refreshAuth();
      } catch (err: unknown) {
        setSaveError(describeAccessError(err));
      } finally {
        setSaving(false);
      }
    },
    [user?.id, profile, fullName, jobTitle, bio, avatarUrl, skillsText, refreshAuth]
  );

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPwError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('The two passwords do not match.');
      return;
    }

    setPwBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) throw err;
      setPwSuccess('Your password has been updated. Use it the next time you sign in.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPwError(describeAccessError(err));
    } finally {
      setPwBusy(false);
    }
  };

  const permissions = [
    { label: 'View dashboard, tasks, projects, meetings and documents', granted: true },
    { label: 'Update tasks assigned to you and post progress updates', granted: true },
    { label: 'Submit ideas and track their review', granted: true },
    { label: 'Record your own learning progress', granted: true },
    { label: 'Invite or remove members', granted: checkRolePermission(role || undefined, 'invite_members') },
    { label: 'Create and archive projects', granted: checkRolePermission(role || undefined, 'create_project') },
    { label: 'Publish organisation-wide announcements', granted: checkRolePermission(role || undefined, 'publish_announcement') },
    { label: 'Review ideas and decide their status', granted: checkRolePermission(role || undefined, 'review_idea') },
    { label: 'Open the Administration Portal', granted: checkRolePermission(role || undefined, 'access_admin_portal') },
    { label: 'Delete meetings', granted: checkRolePermission(role || undefined, 'delete_meeting') },
  ];

  const displayName = fullName || profile?.full_name || user?.email?.split('@')[0] || 'Team Member';

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Profile"
        description="Your identity, contact details, capabilities and account security."
        icon={UserCircle2}
      />

      {saveError && <ErrorState message={saveError} onRetry={() => setSaveError(null)} />}
      {saveSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700" role="status">
          {saveSuccess}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Identity card */}
        <div className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs flex flex-col items-center text-center">
          {profile?.avatar_url || avatarUrl ? (
            <img
              src={avatarUrl || profile?.avatar_url}
              alt={displayName}
              className="w-24 h-24 rounded-full object-cover border-2 border-[#123B73]"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-[#123B73] text-white flex items-center justify-center text-3xl font-bold">
              {initialsOf(displayName)}
            </div>
          )}

          <h2 className="text-base font-bold text-[#172B4D] mt-4">{displayName}</h2>
          <p className="text-xs text-[#65758B]">{profile?.job_title || 'No job title set'}</p>

          <div className="flex flex-wrap justify-center gap-1.5 mt-3">
            <Chip tone="info">{role?.replace(/_/g, ' ') || 'no role assigned'}</Chip>
            {department && <Chip>{department.name}</Chip>}
          </div>

          <div className="w-full mt-5 pt-4 border-t border-[#DCE5F0] space-y-2.5 text-left">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#65758B]">Email</div>
              <div className="text-xs text-[#172B4D] break-all">{user?.email || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#65758B]">Organisation</div>
              <div className="text-xs text-[#172B4D]">{organization?.name || 'Not linked'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#65758B]">Account status</div>
              <div className="text-xs text-[#172B4D] flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${profile?.is_suspended ? 'bg-red-500' : 'bg-emerald-500'}`} />
                {profile?.is_suspended ? 'Suspended' : 'Active'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-[#65758B]">Member since</div>
              <div className="text-xs text-[#172B4D]">{formatDate(profile?.created_at)}</div>
            </div>
          </div>

          <div className="w-full mt-4 p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] text-[11px] text-[#65758B] flex items-start gap-2">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#123B73]" />
            <span>Your role is stored server-side and enforced by database policies. It cannot be changed from this page.</span>
          </div>
        </div>

        {/* Editable profile */}
        <form onSubmit={saveProfile} className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#DCE5F0]">
            <Save className="w-4 h-4 text-[#123B73]" />
            <h2 className="text-sm font-bold text-[#172B4D]">Personal details</h2>
          </div>

          <div>
            <label htmlFor="pf-name" className="block text-xs font-semibold text-[#172B4D] mb-1">
              Display name
            </label>
            <input
              id="pf-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
            />
          </div>

          <div>
            <label htmlFor="pf-title" className="block text-xs font-semibold text-[#172B4D] mb-1">
              Job title
            </label>
            <input
              id="pf-title"
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Frontend Engineer"
              className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
            />
          </div>

          <div>
            <label htmlFor="pf-avatar" className="block text-xs font-semibold text-[#172B4D] mb-1">
              Avatar image URL
            </label>
            <input
              id="pf-avatar"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
            />
            <p className="text-[10px] text-[#65758B] mt-1">Paste a link to an image you are happy to be seen by your team.</p>
          </div>

          <div>
            <label htmlFor="pf-bio" className="block text-xs font-semibold text-[#172B4D] mb-1">
              Short bio
            </label>
            <textarea
              id="pf-bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What do you work on?"
              className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none resize-none"
            />
          </div>

          <div>
            <label htmlFor="pf-skills" className="block text-xs font-semibold text-[#172B4D] mb-1">
              Skills (comma separated)
            </label>
            <input
              id="pf-skills"
              type="text"
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
              placeholder="e.g. React, PostgreSQL, Technical Writing"
              className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
            />
          </div>

          <button type="submit" disabled={saving} className={`${buttonStyles.primary} w-full justify-center`}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        {/* Security + permissions */}
        <div className="space-y-5">
          <form onSubmit={changePassword} className="bg-white p-5 rounded-xl border border-[#DCE5F0] shadow-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#DCE5F0]">
              <Lock className="w-4 h-4 text-[#123B73]" />
              <h2 className="text-sm font-bold text-[#172B4D]">Change password</h2>
            </div>

            {pwError && <ErrorState message={pwError} onRetry={() => setPwError(null)} />}
            {pwSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700" role="status">
                {pwSuccess}
              </div>
            )}

            <div>
              <label htmlFor="pf-pass" className="block text-xs font-semibold text-[#172B4D] mb-1">
                New password
              </label>
              <div className="relative">
                <input
                  id="pf-pass"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  className="w-full px-3 py-2 pr-9 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-2 text-[#65758B] hover:text-[#172B4D]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="pf-pass2" className="block text-xs font-semibold text-[#172B4D] mb-1">
                Confirm new password
              </label>
              <input
                id="pf-pass2"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                className="w-full px-3 py-2 text-xs border border-[#DCE5F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#123B73]"
              />
            </div>

            <button type="submit" disabled={pwBusy} className={`${buttonStyles.secondary} w-full justify-center`}>
              <Lock className="w-3.5 h-3.5" />
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </form>

          <SectionCard title="What you can do here" icon={ShieldCheck}>
            <ul className="space-y-2">
              {permissions.map((p) => (
                <li key={p.label} className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-[#65758B] min-w-0">{p.label}</span>
                  <Chip tone={p.granted ? 'success' : 'neutral'}>{p.granted ? 'Allowed' : 'No access'}</Chip>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-[#65758B] mt-4 pt-3 border-t border-[#DCE5F0] flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#123B73] mt-0.5" />
              These are the same rules the server and the database enforce — they are not just hidden in the interface.
            </p>
          </SectionCard>
        </div>
      </div>

      {!isSupabaseConfigured() && (
        <LoadingState label="Supabase is not configured, so your profile cannot be loaded." />
      )}
    </div>
  );
};
