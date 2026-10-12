import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from './page-header';
import { DataTable, type Column } from './data-table';
import { ConfirmDialog } from './confirm-dialog';
import { apiError, resources } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'tags' | 'checkboxes' | 'email';
  options?: FieldOption[];
  required?: boolean;
  placeholder?: string;
  fullWidth?: boolean;
}

interface ResourcePageProps<T> {
  title: string;
  description?: string;
  endpoint: string;
  queryKey: string;
  columns: Column<T>[];
  fields: FieldConfig[];
  rowKey?: (row: T) => string;
  toForm?: (row: T) => Record<string, unknown>;
  createDefaults?: Record<string, unknown>;
  extraToolbar?: React.ReactNode;
  allowDelete?: boolean;
}

function buildSchema(fields: FieldConfig[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let schema: z.ZodTypeAny;
    switch (field.type) {
      case 'number':
        schema = z.coerce.number({ invalid_type_error: 'Must be a number' });
        break;
      case 'checkbox':
        schema = z.boolean().default(false);
        break;
      case 'tags':
        // Stored as a comma-separated string in the form, split on save.
        schema = z.string();
        break;
      case 'checkboxes':
        schema = z.array(z.string()).default([]);
        break;
      case 'email':
        schema = z.union([z.string().email(), z.literal('')]);
        break;
      default:
        schema = z.string();
    }
    if (!field.required) schema = schema.optional().nullable();
    else if (schema instanceof z.ZodString) schema = schema.min(1, `${field.label} is required`);
    shape[field.name] = schema;
  }
  return z.object(shape);
}

export function ResourcePage<T extends { id: string }>({
  title,
  description,
  endpoint,
  queryKey,
  columns,
  fields,
  rowKey = (row) => row.id,
  toForm,
  createDefaults,
  extraToolbar,
  allowDelete = true,
}: ResourcePageProps<T>) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  const schema = useMemo(() => buildSchema(fields), [fields]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [queryKey, page, search],
    queryFn: () => resources.list<T>(endpoint, { page, pageSize: 20, search }),
  });

  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema) });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        let value = values[field.name];
        if (field.type === 'tags') {
          value = typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value ?? [];
        }
        if (field.type === 'date' && value) value = new Date(value as string).toISOString();
        if (value === '') value = null;
        payload[field.name] = value;
      }
      return editing ? resources.update<T>(`${endpoint}/${editing.id}`, payload) : resources.create<T>(endpoint, payload);
    },
    onSuccess: () => {
      toast.success(editing ? `${title} updated` : `${title} created`);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setOpen(false);
      setEditing(null);
      form.reset({});
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (row: T) => resources.remove(`${endpoint}/${row.id}`),
    onSuccess: () => {
      toast.success(`${title} deleted`);
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset(createDefaults ?? {});
    setOpen(true);
  };

  const openEdit = (row: T) => {
    setEditing(row);
    const source = toForm ? toForm(row) : (row as unknown as Record<string, unknown>);
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = source[field.name];
      if (field.type === 'tags') values[field.name] = Array.isArray(raw) ? raw.join(', ') : (raw ?? '');
      else if (field.type === 'date') values[field.name] = raw ? String(raw).slice(0, 10) : '';
      else values[field.name] = raw ?? (field.type === 'checkbox' ? false : field.type === 'checkboxes' ? [] : '');
    }
    form.reset(values);
    setOpen(true);
  };

  const actionColumn: Column<T> = {
    key: '__actions',
    header: '',
    className: 'w-24 text-right',
    render: (row) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEdit(row); }} aria-label="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {allowDelete && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>
    ),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {extraToolbar}
            <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: [queryKey] })}>
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} /> Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New
            </Button>
          </>
        }
      />

      <DataTable
        columns={[...columns, actionColumn]}
        rows={data?.items ?? []}
        loading={isLoading}
        rowKey={rowKey}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        page={data?.page}
        totalPages={data?.totalPages}
        total={data?.total}
        pageSize={data?.pageSize}
        onPageChange={setPage}
        emptyTitle={`No ${title.toLowerCase()} yet`}
        emptyDescription={`Create your first ${title.toLowerCase()} entry to get started.`}
      />

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${title}` : `New ${title}`}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            {fields.map((field) => (
              <div key={field.name} className={cn('space-y-1.5', field.fullWidth && 'sm:col-span-2')}>
                <Label htmlFor={field.name}>{field.label}</Label>
                {renderField(field, form)}
                {form.formState.errors[field.name] && (
                  <p className="text-xs text-destructive">{String(form.formState.errors[field.name]?.message ?? 'Invalid')}</p>
                )}
              </div>
            ))}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {editing ? 'Save changes' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete ${title}?`}
        description="This action marks the record as inactive or removes it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget);
        }}
      />
    </div>
  );
}

function renderField(field: FieldConfig, form: ReturnType<typeof useForm<Record<string, unknown>>>) {
  const { register, setValue, watch } = form;
  switch (field.type) {
    case 'textarea':
      return <Textarea id={field.name} {...register(field.name)} placeholder={field.placeholder} />;
    case 'number':
      return <Input id={field.name} type="number" {...register(field.name)} placeholder={field.placeholder} />;
    case 'date':
      return <Input id={field.name} type="date" {...register(field.name)} />;
    case 'email':
      return <Input id={field.name} type="email" {...register(field.name)} placeholder={field.placeholder} />;
    case 'select':
      return (
        <Select value={(watch(field.name) as string) ?? ''} onValueChange={(v) => setValue(field.name, v, { shouldValidate: true })}>
          <SelectTrigger>
            <SelectValue placeholder={field.placeholder ?? 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'checkbox':
      return (
        <div className="flex h-9 items-center">
          <Checkbox checked={!!watch(field.name)} onCheckedChange={(v) => setValue(field.name, !!v)} />
        </div>
      );
    case 'checkboxes': {
      const value = (watch(field.name) as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-3 pt-1">
          {(field.options ?? []).map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={value.includes(opt.value)}
                onCheckedChange={(checked) =>
                  setValue(field.name, checked ? [...value, opt.value] : value.filter((v) => v !== opt.value))
                }
              />
              {opt.label}
            </label>
          ))}
        </div>
      );
    }
    default:
      return <Input id={field.name} {...register(field.name)} placeholder={field.placeholder} />;
  }
}
