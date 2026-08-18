import type {
  AnalysisResponse,
  AppSettings,
  DashboardData,
  HistoryData,
  SaveAnalysisPayload,
  Task,
  TaskListResponse,
  TaskPatch,
  Template,
} from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `通信エラーが発生しました（${response.status}）`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const api = {
  getDashboard: () => request<DashboardData>('/api/dashboard'),

  analyze: (payload: { text: string; sourceType: string; tone: string }) =>
    request<AnalysisResponse>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveAnalysis: (payload: SaveAnalysisPayload) =>
    request<AnalysisResponse>('/api/analyze/save', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listTasks: (filters: { q?: string; status?: string; priority?: string; review?: string; sort?: string; limit?: number } = {}) =>
    request<TaskListResponse>(`/api/tasks${queryString(filters)}`),

  updateTask: (id: string, patch: TaskPatch) =>
    request<Task>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  createTask: (task: Omit<TaskPatch, 'status'> & { title: string }) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    }),

  deleteTask: (id: string) =>
    request<void>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  reorderTasks: (taskIds: string[]) =>
    request<{ tasks: Task[] }>('/api/tasks/reorder', {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    }),

  listTemplates: () => request<Template[]>('/api/templates'),

  createTemplate: (template: Pick<Template, 'title' | 'description' | 'source_type' | 'content'>) =>
    request<Template>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(template),
    }),

  updateTemplate: (id: string, patch: Partial<Pick<Template, 'title' | 'description' | 'source_type' | 'content' | 'is_favorite'>>) =>
    request<Template>(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteTemplate: (id: string) =>
    request<void>(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getHistory: () => request<HistoryData>('/api/history'),

  getSettings: () => request<AppSettings>('/api/settings'),

  updateSettings: (settings: AppSettings) =>
    request<AppSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};
