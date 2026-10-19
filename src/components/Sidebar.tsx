import React from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  Video,
  Users,
  Lightbulb,
  GraduationCap,
  Briefcase,
  BarChart3,
  FileText,
  ShieldCheck,
  Bell,
  Megaphone,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NavigationTab, WorkspaceId, WORKSPACES } from '../utils/routes';

// Kept as a re-export so existing imports of NavigationTab stay valid.
export type { NavigationTab };

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Sections the active workspace exposes — everything else is hidden. */
  allowedTabs: NavigationTab[];
  /** Which workspace this sidebar belongs to (used for the header label). */
  workspace: WorkspaceId;
  /** Live unread count mirrored next to Notifications. */
  unreadCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  mobileOpen,
  onCloseMobile,
  allowedTabs,
  workspace,
  unreadCount = 0,
}) => {
  const { hasPermission } = useAuth();

  const navItems: { id: NavigationTab; label: string; icon: React.ElementType; badge?: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects & Tasks', icon: FolderKanban },
    { id: 'meet', label: 'Sam_Teck Meet', icon: Video, badge: 'Live' },
    { id: 'members', label: 'Team & Members', icon: Users },
    { id: 'innovation', label: 'Innovation Lab', icon: Lightbulb },
    { id: 'learning', label: 'Learning Centre', icon: GraduationCap },
    { id: 'business', label: 'Business & Ops', icon: Briefcase },
    { id: 'reports', label: 'Reports & Audit', icon: BarChart3 },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'admin', label: 'Administration', icon: ShieldCheck },
    { id: 'messages', label: 'Messages & Announcements', icon: Megaphone },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  // Two independent gates: the workspace may only offer its own sections, and
  // the Administration entry additionally requires the privileged permission.
  const visibleItems = navItems.filter((item) => {
    if (!allowedTabs.includes(item.id)) return false;
    if (item.id === 'admin' && !hasPermission('access_admin_portal')) return false;
    return true;
  });

  const handleTabClick = (tab: NavigationTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  const meta = WORKSPACES[workspace];

  const navContent = (
    <div className="flex flex-col h-full bg-[#0B1F3A] text-slate-300 w-64 border-r border-[#123B73]/60 select-none">
      <div className="p-4 border-b border-[#123B73]/60 flex items-center justify-between">
        <div>
          <span className="text-xs uppercase tracking-wider font-bold text-blue-300">{meta.shortLabel}</span>
          <div className="text-sm font-semibold text-white">{meta.label}</div>
        </div>
        <button
          onClick={onCloseMobile}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#123B73]"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label={`${meta.label} sections`}>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleTabClick(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-[#123B73] text-white shadow-sm font-semibold border border-[#2457A7]'
                  : 'hover:bg-[#123B73]/40 hover:text-white text-slate-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 ${
                    isActive ? 'text-blue-300' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.id === 'notifications' && unreadCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
              {item.badge && (
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-[#123B73]/60 text-xs text-slate-400">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span>Sam_Teck Hub</span>
          <span className="text-blue-300 font-mono">v1.0.0</span>
        </div>
        <div className="text-[10px] text-slate-500">
          Connected to Supabase &amp; Google Meet
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop permanent sidebar */}
      <aside className="hidden md:block shrink-0 sticky top-16 h-[calc(100vh-4rem)]">
        {navContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 animate-in slide-in-from-left duration-200">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
};
