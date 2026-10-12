import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronRight, LogOut, PanelLeft, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { resources } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';
import { navSections } from './nav';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function useCrumbLabel(pathname: string) {
  return useMemo(() => {
    const segment = pathname.split('/').filter(Boolean)[0] ?? '';
    for (const section of navSections) {
      const match = section.items.find((i) => i.to !== '/' && i.to.includes(segment) && segment);
      if (match) return match.label;
    }
    return null;
  }, [pathname]);
}

export function Topbar() {
  const { user, logout } = useAuth();
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const location = useLocation();
  const navigate = useNavigate();
  const label = useCrumbLabel(location.pathname);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => resources.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Toggle sidebar">
          <PanelLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          {label && (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{label}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild className="relative">
          <Link to="/notifications" aria-label="Notifications">
            <Bell className="h-4 w-4" />
            {!!unread?.count && (
              <Badge variant="danger" className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px]">
                {unread.count}
              </Badge>
            )}
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <UserCircle className="h-4 w-4" />
              <span className="hidden sm:inline">{user?.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm text-foreground">{user?.name}</span>
                <span className="text-xs text-muted-foreground">{user?.role}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <UserCircle className="h-4 w-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
