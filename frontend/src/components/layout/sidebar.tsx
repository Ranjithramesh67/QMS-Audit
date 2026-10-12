import { NavLink } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { navSections } from './nav';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const user = useAuth((s) => s.user);

  const canSee = (permissions?: string[]) => {
    if (!permissions?.length) return true;
    const held = user?.permissions ?? [];
    if (held.includes('*')) return true;
    return permissions.some((key) => held.includes(key));
  };

  return (
    <aside className="relative z-10 flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/15 text-sidebar-foreground">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">QMS Audit</p>
          <p className="text-[10px] uppercase tracking-widest text-sidebar-muted">Quality Platform</p>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto scrollbar-thin px-3 py-4">
        {navSections.map((section) => {
          const items = section.items.filter((i) => canSee(i.permissions));
          if (items.length === 0) return null;
          return (
            <div key={section.title}>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                          : 'text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border px-4 py-3">
        <a
          href="https://keerainnovations.com"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-[11px] text-sidebar-muted transition-colors hover:text-sidebar-foreground"
        >
          Made with <span aria-label="love">&#9829;</span> by KeeRa Innovations
        </a>
      </div>
    </aside>
  );
}
