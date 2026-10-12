import { useQuery } from '@tanstack/react-query';
import { resources } from '@/lib/api';

export interface Option {
  value: string;
  label: string;
}

/** Loads a list resource and maps it to <select> options. */
export function useOptions(
  endpoint: string,
  labelKey: string | ((row: Record<string, unknown>) => string),
  queryKey: string,
  params?: Record<string, unknown>,
): { options: Option[]; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: [queryKey, 'options', params],
    queryFn: () => resources.all<Record<string, unknown>>(endpoint, params),
  });

  const options = (data ?? []).map((row) => ({
    value: String(row.id),
    label: typeof labelKey === 'function' ? labelKey(row) : String(row[labelKey] ?? row.id),
  }));

  return { options, isLoading };
}
