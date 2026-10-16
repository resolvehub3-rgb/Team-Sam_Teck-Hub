import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { SetupBanner } from './components/SetupBanner';
import { MemberLayout } from './components/MemberLayout';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { DashboardView } from './views/DashboardView';
import { ProjectsView } from './views/ProjectsView';
import { SamTeckMeetView } from './views/SamTeckMeetView';
import { MembersView } from './views/MembersView';
import { InnovationLabView } from './views/InnovationLabView';
import { LearningView } from './views/LearningView';
import { BusinessView } from './views/BusinessView';
import { ReportsView } from './views/ReportsView';
import { DocumentsView } from './views/DocumentsView';
import { AdminView } from './views/AdminView';
import { LoginView } from './views/LoginView';
import { FirstTimeSetupView } from './views/FirstTimeSetupView';
import { InviteAcceptView } from './views/InviteAcceptView';

// Member Workspace ("My Workspace") pages
import { MemberDashboardView } from './views/member/MemberDashboardView';
import { MemberTasksView } from './views/member/MemberTasksView';
import { MemberProjectsView } from './views/member/MemberProjectsView';
import { MemberMeetingsView } from './views/member/MemberMeetingsView';
import { MemberMessagesView } from './views/member/MemberMessagesView';
import { MemberInnovationView } from './views/member/MemberInnovationView';
import { MemberLearningView } from './views/member/MemberLearningView';
import { MemberDocumentsView } from './views/member/MemberDocumentsView';
import { MemberNotificationsView } from './views/member/MemberNotificationsView';
import { MemberProfileView } from './views/member/MemberProfileView';
import { MemberHelpView } from './views/member/MemberHelpView';

import {
  NavigationTab,
  WorkspaceId,
  WORKSPACES,
  allowedTabs,
  landingPath,
  parsePath,
  pathFor,
  resolveRoute,
  tabAfterWorkspaceSwitch,
  workspacesForRole,
} from './utils/routes';
import { useNotifications } from './hooks/useNotifications';

const AppContent: React.FC = () => {
  const { user, role, isLoading, roleLoaded, systemSetupStatus, refreshAuth } = useAuth();

  // The address bar is the single source of truth for navigation, so links
  // are shareable and browser history works. `role` always comes from the
  // trusted membership record — never from the URL.
  const [pathname, setPathname] = useState<string>(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [inSetupMode, setInSetupMode] = useState(false);
  const [deniedNoticeDismissed, setDeniedNoticeDismissed] = useState(false);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const parsed = useMemo(() => parsePath(pathname), [pathname]);
  const resolved = useMemo(() => resolveRoute(parsed, role), [parsed, role]);
  const availableWorkspaces = useMemo(() => workspacesForRole(role), [role]);

  const { unreadCount } = useNotifications(user?.id);

  const inviteToken = parsed.kind === 'invite' ? parsed.token : null;
  const activeMeetingSlug = parsed.kind === 'meet' ? parsed.slug : undefined;

  const navigate = useCallback((workspace: WorkspaceId, tab: NavigationTab) => {
    const next = pathFor(workspace, tab);
    window.history.pushState({}, '', next);
    setPathname(next);
    setDeniedNoticeDismissed(false);
  }, []);

  const selectTab = useCallback(
    (tab: NavigationTab) => navigate(resolved.workspace, tab),
    [navigate, resolved.workspace]
  );

  const switchWorkspace = useCallback(
    (workspace: WorkspaceId) => {
      navigate(workspace, tabAfterWorkspaceSwitch(workspace, resolved.tab, role));
    },
    [navigate, resolved.tab, role]
  );

  /**
   * Normalise the URL once the role is known: unknown paths, the bare root,
   * and paths this role may not open all resolve to the role's landing page.
   * `/meet/:slug` and `/invite/:token` are intentionally left untouched.
   */
  useEffect(() => {
    // Wait for the membership lookup: writing a URL for a role we have not
    // learned yet would lock the user into the wrong workspace.
    if (!user || isLoading || !roleLoaded) return;
    if (parsed.kind === 'invite' || parsed.kind === 'meet') return;

    const desired =
      parsed.kind === 'route' ? pathFor(resolved.workspace, resolved.tab) : landingPath(role);

    if (desired !== pathname) {
      window.history.replaceState({}, '', desired);
      setPathname(desired);
    }
  }, [user, isLoading, roleLoaded, parsed, resolved, pathname, role]);

  const routeDenied =
    roleLoaded &&
    !deniedNoticeDismissed &&
    parsed.kind === 'route' &&
    (parsed.workspace !== resolved.workspace || parsed.tab !== resolved.tab);

  // Wait until both the session and the membership lookup behind `role` are
  // known, so the very first URL written is already the right workspace.
  if (isLoading || (user !== null && !roleLoaded)) {
    return (
      <div className="min-h-screen bg-[#F5F8FC] flex flex-col items-center justify-center p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="font-extrabold text-2xl tracking-tight text-[#123B73]">
            Sam_Teck <span className="text-[#2457A7] font-semibold">Hub</span>
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#123B73] text-white">
            SAAS
          </span>
        </div>
        <div className="animate-spin w-6 h-6 border-2 border-[#123B73] border-t-transparent rounded-full mb-2" />
        <p className="text-xs font-semibold text-[#172B4D]">Initializing Sam_Teck Hub...</p>
      </div>
    );
  }

  // 1a. Team invitation landing page — shown to unauthenticated invitees,
  //     so it takes priority over the login/setup gates.
  if (inviteToken) {
    const goHome = () => {
      if (window.location.pathname.startsWith('/invite/')) {
        window.history.replaceState({}, '', '/');
        setPathname('/');
      }
    };
    return <InviteAcceptView token={inviteToken} onAccepted={goHome} onGoToLogin={goHome} />;
  }

  // 1. Mandatory First-Time Administrator Setup Flow (Section 5)
  if (inSetupMode || (!systemSetupStatus.initialAdminProvisioned && systemSetupStatus.canSetup && !user)) {
    return (
      <FirstTimeSetupView
        onSetupSuccess={async () => {
          setInSetupMode(false);
          await refreshAuth();
        }}
      />
    );
  }

  // 2. Unauthenticated: Dedicated Branded Login & Activation View
  if (!user) {
    return <LoginView onGoToSetup={() => setInSetupMode(true)} />;
  }

  const workspace = resolved.workspace;
  const currentTab = resolved.tab;
  const isMemberWorkspace = WORKSPACES[workspace].isMemberWorkspace;
  const sections = allowedTabs(workspace, role);

  const deniedBanner = routeDenied ? (
    <div
      className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start justify-between gap-3"
      role="alert"
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          That section is not available to your role ({role?.replace(/_/g, ' ') || 'no role'}). You have been returned
          to the part of Sam_Teck Hub you are authorised to use.
        </span>
      </div>
      <button
        onClick={() => setDeniedNoticeDismissed(true)}
        className="shrink-0 p-1 rounded hover:bg-amber-100"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : null;

  const shellMain = (
    <>
      {currentTab === 'dashboard' && (
        <DashboardView
          onNavigateTab={(tab) => selectTab(tab as NavigationTab)}
          onOpenCreateProject={() => selectTab('projects')}
          onOpenScheduleMeeting={() => selectTab('meet')}
          onOpenSubmitIdea={() => selectTab('innovation')}
        />
      )}

      {currentTab === 'projects' && <ProjectsView />}

      {currentTab === 'meet' && (
        <SamTeckMeetView
          initialMeetingSlug={activeMeetingSlug}
          onClearMeetingSlug={() => selectTab('meet')}
        />
      )}

      {currentTab === 'members' && <MembersView />}
      {currentTab === 'innovation' && <InnovationLabView />}
      {currentTab === 'learning' && <LearningView />}
      {currentTab === 'business' && <BusinessView />}
      {currentTab === 'reports' && <ReportsView />}
      {currentTab === 'documents' && <DocumentsView />}
      {currentTab === 'admin' && <AdminView />}
      {currentTab === 'messages' && <MemberMessagesView />}
      {currentTab === 'notifications' && <MemberNotificationsView onNavigate={selectTab} />}
    </>
  );

  const memberMain = (
    <>
      {currentTab === 'dashboard' && (
        <MemberDashboardView onNavigate={selectTab} unreadCount={unreadCount} />
      )}
      {currentTab === 'tasks' && <MemberTasksView />}
      {currentTab === 'projects' && <MemberProjectsView />}
      {currentTab === 'meetings' && (
        <MemberMeetingsView
          initialMeetingSlug={activeMeetingSlug}
          onLeaveMeeting={() => selectTab('meetings')}
        />
      )}
      {currentTab === 'messages' && <MemberMessagesView />}
      {currentTab === 'innovation' && <MemberInnovationView />}
      {currentTab === 'learning' && <MemberLearningView />}
      {currentTab === 'documents' && <MemberDocumentsView />}
      {currentTab === 'notifications' && <MemberNotificationsView onNavigate={selectTab} />}
      {currentTab === 'profile' && <MemberProfileView />}
      {currentTab === 'help' && <MemberHelpView onNavigate={selectTab} />}
    </>
  );

  // 3a. Member Workspace — a dedicated shell that looks nothing like the
  //     Administration Portal, with its own navigation and branding.
  if (isMemberWorkspace) {
    return (
      <MemberLayout
        sections={sections}
        currentTab={currentTab}
        onSelectTab={selectTab}
        unreadCount={unreadCount}
        availableWorkspaces={availableWorkspaces}
        activeWorkspace={workspace}
        onSwitchWorkspace={switchWorkspace}
      >
        {deniedBanner}
        {memberMain}
      </MemberLayout>
    );
  }

  // 3b. Administration Portal / Leadership Workspace / Manager Workspace
  return (
    <div className="min-h-screen bg-[#F5F8FC] flex flex-col font-sans">
      <SetupBanner />

      <Navbar
        onOpenInstantMeeting={() => selectTab('meet')}
        onToggleMobileSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        unreadNotificationsCount={unreadCount}
        onNavigateToNotifications={() => selectTab('notifications')}
        workspaceSwitcher={
          availableWorkspaces.length > 1 ? (
            <WorkspaceSwitcher
              available={availableWorkspaces}
              active={workspace}
              onSelect={switchWorkspace}
            />
          ) : undefined
        }
      />

      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        <Sidebar
          currentTab={currentTab}
          onSelectTab={selectTab}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          allowedTabs={sections}
          workspace={workspace}
          unreadCount={unreadCount}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-y-auto">
          {deniedBanner}
          {shellMain}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
