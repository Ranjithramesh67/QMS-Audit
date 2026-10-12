import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';

const schema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Password is required') });
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: 'admin@acme.example', password: 'Password123!' },
  });

  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login(values.email, values.password);
      toast.success('Signed in');
      navigate('/', { replace: true });
    } catch (error) {
      toast.error(apiError(error));
    }
  });

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">QMS Audit Platform</span>
        </div>
        <div className="max-w-md space-y-3">
          <h2 className="text-3xl font-semibold leading-tight">
            Plan, execute and close audits with full traceability.
          </h2>
          <p className="text-sm text-primary-foreground/70">
            A complete 7-stage lifecycle covering System, Product and Process audits across ISO 9001, IATF 16949 and
            VDA 6.3 - from masters setup through CAPA and effectiveness verification.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/50">MonkeyCode AI - Quality Management System</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use your quality management credentials.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
                {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
                {form.formState.errors.password && (
                  <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
            <div className="mt-5 rounded-md border border-border bg-secondary/50 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Demo accounts (password: Password123!)</p>
              <p className="mt-1">admin@acme.example - Administrator</p>
              <p>qmr@acme.example - Quality Management Representative</p>
              <p>lead@acme.example - Lead Auditor</p>
              <p>auditee@acme.example - Auditee</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
