import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Sidebar, NavigationTab } from './components/Sidebar';
import { SetupBanner } from './components/SetupBanner';
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
import { isSupabaseConfigured } from './lib/supabase';

const AppContent: React.FC = () => {
  const { user, isLoading, systemSetupStatus, refreshAuth } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [inSetupMode, setInSetupMode] = useState(false);
  const [activeMeetingSlug, setActiveMeetingSlug] = useState<string | undefined>(undefined);

  // Check URL query parameters or hash for direct meeting links e.g. /meet/:slug
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/meet/')) {
      const slug = path.replace('/meet/', '');
      if (slug) {
        setCurrentTab('meet');
        setActiveMeetingSlug(slug);
      }
    }
  }, []);

  if (isLoading) {
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
    return (
      <LoginView
        onGoToSetup={() => {
          setInSetupMode(true);
        }}
      />
    );
  }

  // 3. Authenticated: Full Production Workspace
  return (
    <div className="min-h-screen bg-[#F5F8FC] flex flex-col font-sans">
      {/* Top Banner: Supabase status / credentials setup if needed */}
      <SetupBanner />

      {/* Main Navbar */}
      <Navbar
        onOpenInstantMeeting={() => {
          setCurrentTab('meet');
        }}
        onToggleMobileSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        unreadNotificationsCount={0}
        onNavigateToNotifications={() => setCurrentTab('dashboard')}
      />

      {/* Workspace Body: Sidebar + Main Content Area */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto">
        <Sidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            setCurrentTab(tab);
            setActiveMeetingSlug(undefined);
          }}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0 overflow-y-auto">
          {currentTab === 'dashboard' && (
            <DashboardView
              onNavigateTab={(tab) => setCurrentTab(tab as NavigationTab)}
              onOpenCreateProject={() => setCurrentTab('projects')}
              onOpenScheduleMeeting={() => setCurrentTab('meet')}
              onOpenSubmitIdea={() => setCurrentTab('innovation')}
            />
          )}

          {currentTab === 'projects' && <ProjectsView />}

          {currentTab === 'meet' && (
            <SamTeckMeetView
              initialMeetingSlug={activeMeetingSlug}
              onClearMeetingSlug={() => setActiveMeetingSlug(undefined)}
            />
          )}

          {currentTab === 'members' && <MembersView />}

          {currentTab === 'innovation' && <InnovationLabView />}

          {currentTab === 'learning' && <LearningView />}

          {currentTab === 'business' && <BusinessView />}

          {currentTab === 'reports' && <ReportsView />}

          {currentTab === 'documents' && <DocumentsView />}

          {currentTab === 'admin' && <AdminView />}
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
