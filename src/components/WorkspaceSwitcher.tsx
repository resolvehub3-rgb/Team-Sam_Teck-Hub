import React, { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Check } from 'lucide-react';
import { WORKSPACES, WorkspaceId } from '../utils/routes';

interface WorkspaceSwitcherProps {
  available: WorkspaceId[];
  active: WorkspaceId;
  onSelect: (ws: WorkspaceId) => void;
}

/**
 * Lets a user with more than one authorised workspace move between them.
 * The list is built from the trusted role held in context — a user can never
 * add a workspace by editing client state or the URL.
 */
export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({ available, active, onSelect }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (available.length <= 1) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0B1F3A]/60 hover:bg-[#0B1F3A] border border-blue-400/20 text-xs font-semibold text-blue-100 transition"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch workspace"
      >
        <span className="hidden sm:inline">{WORKSPACES[active].shortLabel}</span>
        <span className="sm:hidden">Workspace</span>
        <ChevronsUpDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-xl border border-[#DCE5F0] py-1.5 z-50" role="menu">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-[#65758B]">
            Switch workspace
          </div>
          {available.map((ws) => (
            <button
              key={ws}
              role="menuitemradio"
              aria-checked={ws === active}
              onClick={() => {
                setOpen(false);
                if (ws !== active) onSelect(ws);
              }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                ws === active ? 'bg-[#F5F8FC] text-[#123B73] font-semibold' : 'text-[#172B4D] hover:bg-[#F5F8FC]'
              }`}
            >
              <span>{WORKSPACES[ws].label}</span>
              {ws === active && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
