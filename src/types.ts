export type Priority = 'high' | 'medium' | 'low';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';
export type NavKey = 'ホーム' | 'AI整理' | 'タスク一覧' | 'テンプレート' | '履歴' | '設定';

export interface Task {
  id: string;
  analysis_id?: string | null;
  title: string;
  assignee: string;
  deadline: string | null;
  priority: Priority;
  confirmation: string;
  prerequisite: string;
  execution_order?: number | null;
  category: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: number;
  analysis_id?: string | null;
  action: string;
  detail: string;
  created_at: string;
}

export interface Summary {
  today: number;
  urgent: number;
  waiting: number;
  completionRate: number;
}

export interface DashboardData {
  summary: Summary;
  tasks: Task[];
  activities: ActivityLog[];
  latestReplyDraft: string;
}

export interface AnalysisResponse {
  analysisId: string;
  tasks: Task[];
  replyDraft: string;
  model: string;
}

export interface SaveAnalysisPayload {
  analysisId: string;
  text: string;
  sourceType: string;
  tone: string;
  replyDraft: string;
  model: string;
  tasks: Task[];
}

export interface TaskPatch {
  title?: string;
  assignee?: string;
  deadline?: string | null;
  priority?: Priority;
  confirmation?: string;
  prerequisite?: string;
  execution_order?: number | null;
  category?: string;
  status?: TaskStatus;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

export interface Template {
  id: string;
  title: string;
  description: string;
  source_type: string;
  content: string;
  is_favorite: number;
  created_at: string;
  updated_at: string;
}

export interface AnalysisHistoryItem {
  id: string;
  source_text: string;
  source_type: string;
  tone: string;
  reply_draft: string;
  model: string;
  created_at: string;
  task_count: number;
}

export interface HistoryData {
  analyses: AnalysisHistoryItem[];
  activities: ActivityLog[];
}

export interface AppSettings {
  display_name: string;
  workspace_name: string;
  default_tone: string;
  default_source_type: string;
}
