import { Outlet } from 'react-router-dom';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const open = useUi((s) => s.sidebarOpen);
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className={cn('hidden transition-all md:block', open ? 'w-64' : 'w-0 overflow-hidden')}>
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
