import React from 'react';
import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Video,
  Megaphone,
  Lightbulb,
  GraduationCap,
  FileText,
  Bell,
  UserCircle2,
  LifeBuoy,
  X,
} from 'lucide-react';
import { NavigationTab } from '../utils/routes';

const TAB_ICONS: Record<NavigationTab, React.ElementType> = {
  dashboard: LayoutDashboard,
  tasks: CheckSquare,
  projects: FolderKanban,
  meetings: Video,
  messages: Megaphone,
  innovation: Lightbulb,
  learning: GraduationCap,
  documents: FileText,
  notifications: Bell,
  profile: UserCircle2,
  help: LifeBuoy,
  // Not reachable from the member workspace.
  meet: Video,
  members: UserCircle2,
  business: FolderKanban,
  reports: FileText,
  admin: LifeBuoy,
};

const TAB_LABELS: Record<NavigationTab, string> = {
  dashboard: 'Dashboard',
  tasks: 'My Tasks',
  projects: 'My Projects',
  meetings: 'Meetings',
  messages: 'Messages & Announcements',
  innovation: 'Innovation Lab',
  learning: 'Learning Centre',
  documents: 'Documents',
  notifications: 'Notifications',
  profile: 'My Profile',
  help: 'Help & Support',
  meet: 'Sam_Teck Meet',
  members: 'Team & Members',
  business: 'Business & Ops',
  reports: 'Reports & Audit',
  admin: 'Administration',
};

interface MemberSidebarProps {
  items: NavigationTab[];
  currentTab: NavigationTab;
  onSelect: (tab: NavigationTab) => void;
  unreadCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

/**
 * Navigation for "My Workspace". Only sections the member is authorised to
 * use are rendered — there are no dead links to administrative screens.
 */
export const MemberSidebar: React.FC<MemberSidebarProps> = ({
  items,
  currentTab,
  onSelect,
  unreadCount,
  mobileOpen,
  onCloseMobile,
}) => {
  const handleSelect = (tab: NavigationTab) => {
    onSelect(tab);
    onCloseMobile();
  };

  const nav = (
    <div className="flex flex-col h-full bg-[#0B1F3A] text-slate-300 w-64 border-r border-[#123B73]/60 select-none">
      <div className="p-4 border-b border-[#123B73]/60 flex items-center justify-between">
        <div>
          <span className="text-[10px] uppercase tracking-wider font-bold text-blue-300">Member Area</span>
          <div className="text-sm font-semibold text-white">My Workspace</div>
        </div>
        <button
          onClick={onCloseMobile}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#123B73]"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Member workspace sections">
        {items.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const isActive = currentTab === tab;
          return (
            <button
              key={tab}
              onClick={() => handleSelect(tab)}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-[#123B73] text-white shadow-sm font-semibold border border-[#2457A7]'
                  : 'hover:bg-[#123B73]/40 hover:text-white text-slate-300'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-300' : 'text-slate-400'}`} />
                <span className="truncate">{TAB_LABELS[tab]}</span>
              </div>
              {tab === 'notifications' && unreadCount > 0 && (
                <span
                  className="ml-2 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white"
                  aria-label={`${unreadCount} unread notifications`}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[#123B73]/60 text-xs text-slate-400">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span>Sam_Teck Hub</span>
          <span className="text-blue-300 font-mono">v1.0.0</span>
        </div>
        <div className="text-[10px] text-slate-500">Technology · Business · Learning · Innovation</div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden md:block shrink-0 sticky top-16 h-[calc(100vh-4rem)]">{nav}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-label="Member navigation">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs" onClick={onCloseMobile} />
          <div className="relative z-10">{nav}</div>
        </div>
      )}
    </>
  );
};

export { TAB_LABELS };
