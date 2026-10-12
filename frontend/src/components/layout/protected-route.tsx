import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { can as hasAnyPermission, useAuth } from '@/store/auth';
import { LoadingBlock } from '@/components/ui/spinner';

export function ProtectedRoute({
  children,
  permissions,
}: {
  children: React.ReactNode;
  permissions?: string[];
}) {
  const { user, status, hydrate } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (status === 'idle') void hydrate();
  }, [status, hydrate]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingBlock label="Authenticating..." />
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (permissions && permissions.length > 0 && !hasAnyPermission(user.permissions, ...permissions)) {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground">Your role ({user.role}) cannot view this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}
