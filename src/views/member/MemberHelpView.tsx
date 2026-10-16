import React, { useState } from 'react';
import {
  LifeBuoy,
  ChevronDown,
  Keyboard,
  Mail,
  BookOpen,
  AlertTriangle,
  Users,
  Lock,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { NavigationTab, WORKSPACES } from '../../utils/routes';
import { PageHeader, SectionCard, Chip } from '../../components/ui';

interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * Help & Support. Everything here describes the system as it actually
 * behaves — there is no invented response-time promise, ticket system or
 * contact number behind this page.
 */
export const MemberHelpView: React.FC<{ onNavigate: (tab: NavigationTab) => void }> = ({ onNavigate }) => {
  const { user, profile, role, organization } = useAuth();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs: FaqEntry[] = [
    {
      question: 'Why can I not see the Administration Portal?',
      answer:
        'Sections are shown only when your role is authorised for them. Administration is limited to super administrators and team leaders. Your role is stored in your organisation membership record on the server, so it cannot be changed by editing the address bar.',
    },
    {
      question: 'A task I should be working on is not in My Tasks.',
      answer:
        'My Tasks lists work assigned to you or created by you. Projects become visible when a lead adds you to their team or assigns you a task inside them. Ask the project manager to add you to the project team.',
    },
    {
      question: 'How do I change the status of my work?',
      answer:
        'Open a task and choose one of the transitions offered to you — for example To Do to In Progress, or In Review to Done. Reassigning a task, moving it to another project, or reopening a completed task is restricted to project leads and is enforced by the database.',
    },
    {
      question: 'Who can publish announcements?',
      answer:
        'Announcements are published by leadership: super administrators, team leaders, assistant leaders and department leads. Members read and acknowledge them in Messages & Announcements.',
    },
    {
      question: 'Can I approve my own idea in the Innovation Lab?',
      answer:
        'No. You can submit an idea and follow its progress, but the status is decided by leadership during review. The database rejects an attempt to change an idea status from a non-leadership account.',
    },
    {
      question: 'My file upload failed — what do I do?',
      answer:
        'Uploads are stored in a private bucket that only members of your organisation can reach. If the message says storage is not configured, an administrator still has to create the "documents" bucket in Supabase. Nothing is recorded against the document library until the file has actually been stored.',
    },
    {
      question: 'Where do meeting tokens come from?',
      answer:
        'Sam_Teck Meet tokens are minted by the server after it verifies your session and checks that you are entitled to the room. LiveKit credentials never reach the browser, and you cannot join a room you were not invited to.',
    },
    {
      question: 'I was not notified about anything.',
      answer:
        'Notifications are produced by database triggers when a task is assigned or commented on, when you are invited to a meeting, when your idea is reviewed, and when an announcement is published. Check your notification preferences from the notification centre.',
    },
  ];

  const shortcuts = [
    { keys: 'Dashboard', action: 'Your overview: assignments, meetings, announcements' },
    { keys: 'My Tasks', action: 'Search, filter, sort and update your own work' },
    { keys: 'My Projects', action: 'Projects you own, manage or hold tasks in' },
    { keys: 'Meetings', action: 'Upcoming, invited and previous sessions' },
    { keys: 'Messages & Announcements', action: 'Leadership updates and team activity' },
    { keys: 'Innovation Lab', action: 'Submit and track ideas' },
    { keys: 'Learning Centre', action: 'Courses and your own progress' },
    { keys: 'Documents', action: 'Shared files, search and upload' },
    { keys: 'Notifications', action: 'Everything addressed to you, in real time' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Help & Support"
        description="How Sam_Teck Hub works for your role, and where to go next."
        icon={LifeBuoy}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <SectionCard title="Frequently asked questions" icon={BookOpen}>
            <div className="divide-y divide-[#DCE5F0]">
              {faqs.map((f, i) => (
                <div key={f.question}>
                  <button
                    onClick={() => setOpenIndex(openIndex === i ? null : i)}
                    className="w-full py-3 flex items-center justify-between gap-3 text-left"
                    aria-expanded={openIndex === i}
                  >
                    <span className="text-xs font-semibold text-[#172B4D]">{f.question}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#65758B] shrink-0 transition-transform ${
                        openIndex === i ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {openIndex === i && (
                    <p className="pb-3 text-xs text-[#65758B] leading-relaxed">{f.answer}</p>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Sections available to you" icon={Users}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { tab: 'dashboard' as NavigationTab, label: 'Dashboard' },
                { tab: 'tasks' as NavigationTab, label: 'My Tasks' },
                { tab: 'projects' as NavigationTab, label: 'My Projects' },
                { tab: 'meetings' as NavigationTab, label: 'Meetings' },
                { tab: 'messages' as NavigationTab, label: 'Messages & Announcements' },
                { tab: 'innovation' as NavigationTab, label: 'Innovation Lab' },
                { tab: 'learning' as NavigationTab, label: 'Learning Centre' },
                { tab: 'documents' as NavigationTab, label: 'Documents' },
                { tab: 'notifications' as NavigationTab, label: 'Notifications' },
                { tab: 'profile' as NavigationTab, label: 'My Profile' },
              ].map((s) => (
                <button
                  key={s.tab}
                  onClick={() => onNavigate(s.tab)}
                  className="px-3 py-2.5 text-left text-xs font-semibold text-[#172B4D] border border-[#DCE5F0] rounded-lg hover:border-[#123B73] hover:bg-[#F5F8FC] transition"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#65758B] mt-3">
              You are working in <span className="font-semibold text-[#172B4D]">{WORKSPACES.workspace.label}</span>.
              Management and administrative workspaces are only reachable if your role grants them.
            </p>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Your account" icon={Lock}>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-[#65758B]">Signed in as</span>
                <span className="font-semibold text-[#172B4D] text-right break-all">{user?.email || '—'}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#65758B]">Display name</span>
                <span className="font-semibold text-[#172B4D] text-right">{profile?.full_name || '—'}</span>
              </div>
              <div className="flex justify-between gap-3 items-center">
                <span className="text-[#65758B]">Role</span>
                <Chip tone="info">{role?.replace(/_/g, ' ') || 'none'}</Chip>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#65758B]">Organisation</span>
                <span className="font-semibold text-[#172B4D] text-right">{organization?.name || 'Not linked'}</span>
              </div>
            </div>
            <button
              onClick={() => onNavigate('profile')}
              className="mt-4 w-full px-3.5 py-2 border border-[#DCE5F0] rounded-lg text-xs font-semibold text-[#123B73] hover:bg-[#F5F8FC] transition"
            >
              Open My Profile
            </button>
          </SectionCard>

          <SectionCard title="Keyboard & navigation" icon={Keyboard}>
            <div className="space-y-2">
              {shortcuts.map((s) => (
                <div key={s.keys} className="text-xs">
                  <div className="font-semibold text-[#172B4D]">{s.keys}</div>
                  <div className="text-[11px] text-[#65758B]">{s.action}</div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="When something is wrong" icon={AlertTriangle}>
            <p className="text-xs text-[#65758B] leading-relaxed">
              If a page shows an error, it is shown on purpose — Sam_Teck Hub does not confirm an action that did not
              happen. Retry from the button on the message, and if it persists, send the exact wording of the message to
              your workspace administrator.
            </p>
            <div className="mt-3 p-3 rounded-lg bg-[#F5F8FC] border border-[#DCE5F0] text-[11px] text-[#65758B] flex items-start gap-2">
              <Mail className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#123B73]" />
              <span>
                Support contact details are configured by your organisation — check with your team leader for the right
                channel.
              </span>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
};
