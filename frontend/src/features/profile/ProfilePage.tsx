import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/common/page-header';
import { useAuth } from '@/store/auth';
import { api, apiError } from '@/lib/api';

const schema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(8, 'At least 8 characters'),
});

export function ProfilePage() {
  const user = useAuth((s) => s.user);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/auth/change-password', values);
      toast.success('Password updated');
      form.reset();
    } catch (error) {
      toast.error(apiError(error));
    }
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" description="Your account details and security settings." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Signed in identity and access level.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Name" value={user?.name ?? '-'} />
            <Row label="Email" value={user?.email ?? '-'} />
            <Row label="Designation" value={user?.designation ?? '-'} />
            <Row label="Plant" value={user?.plant?.name ?? '-'} />
            <Row label="Department" value={user?.department?.name ?? '-'} />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Role</span>
              <Badge variant="accent">{user?.roleName ?? user?.role}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Use at least 8 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Current password</Label>
                <Input type="password" {...form.register('currentPassword')} />
              </div>
              <div className="space-y-1.5">
                <Label>New password</Label>
                <Input type="password" {...form.register('newPassword')} />
                {form.formState.errors.newPassword && (
                  <p className="text-xs text-destructive">{form.formState.errors.newPassword.message}</p>
                )}
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Update password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
