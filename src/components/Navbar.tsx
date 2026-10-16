import React, { useState } from 'react';
import {
  Video,
  Bell,
  LogOut,
  User as UserIcon,
  Shield,
  Menu,
  X,
  Radio,
  ExternalLink,
  ChevronDown
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/database';

interface NavbarProps {
  onOpenInstantMeeting: () => void;
  onToggleMobileSidebar: () => void;
  unreadNotificationsCount?: number;
  onNavigateToNotifications?: () => void;
}

const roleDisplayMap: Record<UserRole, { label: string; badgeClass: string }> = {
  super_admin: { label: 'Super Administrator', badgeClass: 'bg-red-500/20 text-red-200 border-red-500/30' },
  team_leader: { label: 'Team Leader / Founder', badgeClass: 'bg-blue-500/20 text-blue-200 border-blue-500/30' },
  assistant_leader: { label: 'Assistant Team Leader', badgeClass: 'bg-indigo-500/20 text-indigo-200 border-indigo-300' },
  project_manager: { label: 'Project Manager', badgeClass: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30' },
  department_lead: { label: 'Department Lead', badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-500/30' },
  team_member: { label: 'Team Member', badgeClass: 'bg-slate-500/20 text-slate-200 border-slate-500/30' },
  guest: { label: 'External Guest', badgeClass: 'bg-purple-500/20 text-purple-200 border-purple-500/30' },
};

export const Navbar: React.FC<NavbarProps> = ({
  onOpenInstantMeeting,
  onToggleMobileSidebar,
  unreadNotificationsCount = 0,
  onNavigateToNotifications,
}) => {
  const { user, profile, role, organization, signOut } = useAuth();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const roleInfo = role ? roleDisplayMap[role] : { label: 'Authenticated Member', badgeClass: 'bg-blue-500/20 text-blue-200 border-blue-400' };

  return (
    <header className="bg-[#123B73] border-b border-[#0B1F3A] text-white sticky top-0 z-40 select-none shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Mobile hamburger + Wordmark Branding */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleMobileSidebar}
            className="md:hidden p-2 rounded-md hover:bg-[#2457A7] text-white focus:outline-none"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight text-white">
                  Sam_Teck <span className="text-blue-300 font-semibold">Hub</span>
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#0B1F3A] text-blue-200 border border-blue-400/20">
                  SAAS
                </span>
              </div>
              {organization && (
                <div className="text-[11px] text-blue-200/80 truncate max-w-[180px] sm:max-w-[240px]">
                  {organization.name}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center / Right: Quick Actions, Sam_Teck Meet shortcut, User status */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Sam_Teck Meet Instant Trigger */}
          <button
            onClick={onOpenInstantMeeting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2457A7] hover:bg-blue-600 text-white text-xs sm:text-sm font-semibold transition shadow-sm active:scale-95"
            title="Launch branded Sam_Teck Meet"
          >
            <Video className="w-4 h-4 text-emerald-300" />
            <span className="hidden xs:inline">Sam_Teck Meet</span>
            <span className="xs:hidden">Meet</span>
          </button>

          {/* Notifications button */}
          <button
            onClick={onNavigateToNotifications}
            className="relative p-2 rounded-lg hover:bg-[#2457A7] text-blue-100 hover:text-white transition"
            aria-label="View notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* User profile & role badge */}
          {user ? (
            <div className="relative">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg hover:bg-[#2457A7] transition border border-transparent hover:border-blue-400/30 text-left"
              >
                <div className="w-8 h-8 rounded-full bg-[#0B1F3A] border border-blue-300/40 flex items-center justify-center text-xs font-bold text-blue-100">
                  {profile?.full_name ? profile.full_name[0].toUpperCase() : 'U'}
                </div>
                <div className="hidden lg:block">
                  <div className="text-xs font-semibold text-white leading-tight">
                    {profile?.full_name || user.email?.split('@')[0]}
                  </div>
                  <div className="text-[10px] text-blue-200 leading-tight">
                    {roleInfo.label}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-blue-200" />
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-[#DCE5F0] py-2 text-[#172B4D] z-50">
                  <div className="px-4 py-2 border-b border-[#DCE5F0]">
                    <p className="text-xs text-[#65758B]">Signed in as</p>
                    <p className="text-sm font-semibold text-[#172B4D] truncate">{user.email}</p>
                    <div className="mt-1">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F8FC] border border-[#DCE5F0] text-[#123B73]">
                        {roleInfo.label}
                      </span>
                    </div>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        setProfileDropdownOpen(false);
                        signOut();
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-blue-200">Session Required</div>
          )}
        </div>
      </div>
    </header>
  );
};
