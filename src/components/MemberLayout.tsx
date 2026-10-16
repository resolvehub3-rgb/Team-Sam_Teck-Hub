import React, { useEffect, useState } from 'react';
import { Bell, LogOut, Menu, UserCircle2, ChevronDown, Briefcase, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Department } from '../types/database';
import { NavigationTab, WORKSPACES, WorkspaceId } from '../utils/routes';
import { isLeadershipRole } from '../utils/rules';
import { initialsOf } from '../utils/format';
import { MemberSidebar } from './MemberSidebar';
import { SetupBanner } from './SetupBanner';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface MemberLayoutProps {
  sections: NavigationTab[];
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  unreadCount: number;
  availableWorkspaces: WorkspaceId[];
  activeWorkspace: WorkspaceId;
  onSwitchWorkspace: (ws: WorkspaceId) => void;
  children: React.ReactNode;
}

/**
 * The shell of "My Workspace": a member-specific sidebar, a top bar with the
 * product branding, the member's real identity, a live notification
 * indicator, a profile menu and a secure sign-out.
 */
export const MemberLayout: React.FC<MemberLayoutProps> = ({
  sections,
  currentTab,
  onSelectTab,
  unreadCount,
  availableWorkspaces,
  activeWorkspace,
  onSwitchWorkspace,
  children,
}) => {
  const { user, profile, role, organization, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [department, setDepartment] = useState<Department | null>(null);

  // The department lives in its own table, so resolve its name for display.
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

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Team Member';
  const avatarUrl = profile?.avatar_url;
  const roleLabel = role ? role.replace(/_/g, ' ') : 'member';

  return (
    <div className="min-h-screen bg-[#F5F8FC] flex flex-col font-sans">
      <SetupBanner />

      {/* Top bar */}
      <header className="bg-[#123B73] border-b border-[#0B1F3A] text-white sticky top-0 z-40 select-none shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-md hover:bg-[#2457A7] focus:outline-none"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight text-white">Sam_Teck</span>
                <span className="text-blue-300 font-semibold">Hub</span>
                <span className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#0B1F3A] text-blue-200 border border-blue-400/20">
                  {WORKSPACES[activeWorkspace].shortLabel}
                </span>
              </div>
              <div className="text-[11px] text-blue-200/80 truncate max-w-[160px] sm:max-w-[260px]">
                {organization?.name || 'My Workspace'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {availableWorkspaces.length > 1 && (
              <WorkspaceSwitcher
                available={availableWorkspaces}
                active={activeWorkspace}
                onSelect={onSwitchWorkspace}
              />
            )}

            <button
              onClick={() => onSelectTab('notifications')}
              className="relative p-2 rounded-lg hover:bg-[#2457A7] text-blue-100 hover:text-white transition"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-red-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg hover:bg-[#2457A7] transition border border-transparent hover:border-blue-400/30 text-left"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-8 h-8 rounded-full object-cover border border-blue-300/40"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#0B1F3A] border border-blue-300/40 flex items-center justify-center text-xs font-bold text-blue-100">
                    {initialsOf(displayName)}
                  </div>
                )}
                <div className="hidden lg:block max-w-[150px]">
                  <div className="text-xs font-semibold text-white leading-tight truncate">{displayName}</div>
                  <div className="text-[10px] text-blue-200 leading-tight capitalize truncate">{roleLabel}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-blue-200" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[#DCE5F0] py-2 text-[#172B4D] z-50">
                  <div className="px-4 py-2 border-b border-[#DCE5F0]">
                    <p className="text-xs font-semibold text-[#172B4D] truncate">{displayName}</p>
                    <p className="text-[11px] text-[#65758B] truncate">{user?.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F8FC] border border-[#DCE5F0] text-[#123B73] capitalize">
                        {roleLabel}
                      </span>
                      {department && (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F8FC] border border-[#DCE5F0] text-[#65758B]">
                          {department.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onSelectTab('profile');
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-[#172B4D] hover:bg-[#F5F8FC] flex items-center gap-2"
                    >
                      <UserCircle2 className="w-4 h-4 text-[#65758B]" />
                      My Profile
                    </button>

                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onSelectTab('help');
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-[#172B4D] hover:bg-[#F5F8FC] flex items-center gap-2"
                    >
                      <Briefcase className="w-4 h-4 text-[#65758B]" />
                      Help & Support
                    </button>

                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        signOut();
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>

                  {isLeadershipRole(role || undefined) && (
                    <div className="px-4 py-2 border-t border-[#DCE5F0] text-[11px] text-[#65758B] flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#123B73]" />
                      Switch to a leadership workspace above.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex max-w-7xl w-full mx-auto" onClick={() => menuOpen && setMenuOpen(false)}>
        <MemberSidebar
          items={sections}
          currentTab={currentTab}
          onSelect={onSelectTab}
          unreadCount={unreadCount}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
};
