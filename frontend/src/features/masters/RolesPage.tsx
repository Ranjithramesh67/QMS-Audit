import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { PageHeader } from '@/components/common/page-header';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { apiError, resources } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

interface PermissionCatalog {
  wildcard: string;
  groups: { group: string; permissions: PermissionDef[] }[];
  permissions: PermissionDef[];
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  active: boolean;
  _count: { users: number };
}

interface RoleFormState {
  code: string;
  name: string;
  description: string;
  permissions: string[];
}

const EMPTY_FORM: RoleFormState = { code: '', name: '', description: '', permissions: [] };

function groupSelected(group: PermissionDef[], selected: string[]): 'all' | 'some' | 'none' {
  const keys = group.map((p) => p.key);
  const count = keys.filter((k) => selected.includes(k)).length;
  if (count === 0) return 'none';
  if (count === keys.length) return 'all';
  return 'some';
}

export function RolesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form, setForm] = useState<RoleFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => resources.all<RoleRow>('/roles'),
  });

  const catalogQuery = useQuery({
    queryKey: ['roles', 'permissions'],
    queryFn: () => resources.get<PermissionCatalog>('/roles/permissions'),
  });

  const catalog = catalogQuery.data;
  const fullAccess = !!form.permissions.includes('*');

  const validationError = useMemo(() => {
    if (!form.name.trim()) return 'Name is required';
    if (!editing && !/^[A-Z][A-Z0-9_]*$/.test(form.code.trim())) {
      return 'Code must be uppercase letters, digits or underscores';
    }
    if (!fullAccess && form.permissions.length === 0) return 'Select at least one permission or grant full access';
    return null;
  }, [form, editing, fullAccess]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        permissions: fullAccess ? [catalog?.wildcard ?? '*'] : form.permissions,
      };
      if (editing) return resources.update<RoleRow>(`/roles/${editing.id}`, payload);
      return resources.create<RoleRow>('/roles', { ...payload, code: form.code.trim() });
    },
    onSuccess: () => {
      toast.success(editing ? 'Role updated' : 'Role created');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setOpen(false);
      setEditing(null);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (role: RoleRow) => resources.remove(`/roles/${role.id}`),
    onSuccess: () => {
      toast.success('Role deleted');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (role: RoleRow) => {
    setEditing(role);
    setForm({
      code: role.code,
      name: role.name,
      description: role.description ?? '',
      permissions: [...role.permissions],
    });
    setOpen(true);
  };

  const togglePermission = (key: string, checked: boolean) => {
    setForm((prev) => {
      const withoutWildcard = prev.permissions.filter((p) => p !== '*');
      const next = checked ? [...withoutWildcard, key] : withoutWildcard.filter((p) => p !== key);
      return { ...prev, permissions: next };
    });
  };

  const toggleGroup = (group: PermissionDef[], checked: boolean) => {
    const keys = group.map((p) => p.key);
    setForm((prev) => {
      const withoutWildcard = prev.permissions.filter((p) => p !== '*');
      const next = checked
        ? Array.from(new Set([...withoutWildcard, ...keys]))
        : withoutWildcard.filter((p) => !keys.includes(p));
      return { ...prev, permissions: next };
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Roles & Permissions"
        description="Define what each role can do, then assign roles to users."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['roles'] })}>
              <RefreshCw className={cn('h-4 w-4', rolesQuery.isFetching && 'animate-spin')} /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New role
            </Button>
          </>
        }
      />

      {rolesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading roles...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(rolesQuery.data ?? []).map((role) => {
            const wildcard = role.permissions.includes(catalog?.wildcard ?? '*');
            return (
              <Card key={role.id}>
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold">{role.name}</h2>
                        {role.isSystem && <Badge variant="secondary">Built-in</Badge>}
                        {!role.active && <Badge variant="warning">Disabled</Badge>}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">{role.code}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${role.name}`} onClick={() => openEdit(role)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {!role.isSystem && (
                        <Button variant="ghost" size="icon" aria-label={`Delete ${role.name}`} onClick={() => setDeleteTarget(role)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}

                  <div className="flex flex-wrap items-center gap-2">
                    {wildcard ? (
                      <Badge variant="accent">
                        <ShieldCheck className="mr-1 h-3 w-3" /> Full access
                      </Badge>
                    ) : (
                      <Badge variant="info">{role.permissions.length} permissions</Badge>
                    )}
                    <Badge variant="outline">
                      <Users className="mr-1 h-3 w-3" /> {role._count.users} user{role._count.users === 1 ? '' : 's'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New role'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update the role name and its permissions.' : 'Create a role and choose what it can access.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role-code">Code</Label>
                <Input
                  id="role-code"
                  value={form.code}
                  disabled={!!editing}
                  placeholder="QUALITY_ENGINEER"
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                />
                <p className="text-xs text-muted-foreground">Stable identifier. Uppercase letters, digits, underscore.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={form.name}
                  placeholder="Quality Engineer"
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                value={form.description}
                placeholder="What is this role responsible for?"
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <label className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4" /> Full access
                <span className="font-normal text-muted-foreground">- grants every permission</span>
              </span>
              <Checkbox
                aria-label="Full access"
                checked={fullAccess}
                onCheckedChange={(checked) =>
                  setForm((p) => ({ ...p, permissions: checked ? ['*'] : p.permissions.filter((x) => x !== '*') }))
                }
              />
            </label>

            <div className={cn('space-y-4', fullAccess && 'pointer-events-none opacity-50')}>
              {(catalog?.groups ?? []).map((section) => {
                const state = groupSelected(section.permissions, form.permissions);
                return (
                  <div key={section.group} className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      <Checkbox
                        aria-label={`Select all ${section.group}`}
                        checked={state === 'all' ? true : state === 'some' ? 'indeterminate' : false}
                        onCheckedChange={(checked) => toggleGroup(section.permissions, checked === true)}
                      />
                      {section.group}
                    </label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {section.permissions.map((permission) => (
                        <label key={permission.key} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm">
                          <Checkbox
                            className="mt-0.5"
                            checked={form.permissions.includes(permission.key)}
                            onCheckedChange={(checked) => togglePermission(permission.key, checked === true)}
                          />
                          <span className="space-y-0.5">
                            <span className="block font-medium leading-tight">{permission.label}</span>
                            <span className="block text-xs text-muted-foreground">{permission.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {validationError && <p className="text-xs text-destructive">{validationError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!!validationError || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {editing ? 'Save changes' : 'Create role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? 'role'}?`}
        description="Users must be reassigned before a role can be deleted. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget);
        }}
      />
    </div>
  );
}
