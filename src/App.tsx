import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  Bell,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clipboard,
  Clock3,
  FileText,
  Filter,
  History,
  GripVertical,
  Home,
  LayoutList,
  LoaderCircle,
  Mail,
  Menu,
  MessageSquareText,
  MessagesSquare,
  NotebookText,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { api } from './api';
import type {
  AnalysisHistoryItem,
  AnalysisResponse,
  AppSettings,
  DashboardData,
  HistoryData,
  NavKey,
  Priority,
  Task,
  TaskStatus,
  Template,
} from './types';

const workRequestSample = `明日の午前中までに田中さんに売上資料を確認してもらい、確認が終わって問題がなければ部長へ送付してください。
あわせて月末までに先月分との比較表を作成してください。
取引先への共有も必要ですが、担当者と期限はまだ決まっていません。`;

const sampleText = `会議名：新サービス公開に向けた進捗確認ミーティング
日時：2026年8月12日 10:00〜11:00
参加者：山田花子、佐藤健太、鈴木美咲、田中翔太

新サービスの公開予定日は9月1日で進めることを確認した。
現在、トップページのデザインはほぼ完成しているが、一部の画像と説明文が未確定となっている。

山田さんは、8月18日までにトップページの最終デザインを完成させる。あわせて、スマートフォン表示に崩れがないか確認する。

佐藤さんは、新規ユーザー登録機能の動作確認を担当する。メール認証、パスワード再設定、エラー表示を中心にテストし、8月20日までに結果を共有する。不具合を発見した場合は、内容と再現手順を開発チームに報告する。

鈴木さんは、サービス紹介ページに掲載する文章を8月16日までに作成する。完成後、山田さんへ共有し、デザインへの反映を依頼する。また、利用規約の文章について法務担当へ確認を依頼する。

田中さんは、公開前の最終チェックリストを作成する。確認項目には、PC・スマートフォン表示、問い合わせフォーム、ユーザー登録、ログイン、リンク切れの確認を含める。期限は8月22日とする。

広告については、SNS広告を8月25日から開始する予定。広告用の画像は山田さん、広告文章は鈴木さんが担当する。8月21日までに素材を完成させる。

問い合わせフォームについて、現在送信後の確認メールが届かない場合があることが判明した。佐藤さんが原因を調査し、8月15日までに対応方針を報告する。優先度は高とする。

次回ミーティングは8月19日10時から実施する。各担当者は、それまでに現在の進捗と問題点を整理しておく。`;

const initialDashboard: DashboardData = {
  summary: { today: 0, urgent: 0, waiting: 0, completionRate: 0 },
  tasks: [],
  activities: [],
  latestReplyDraft: '',
};

const initialHistory: HistoryData = { analyses: [], activities: [] };

const initialSettings: AppSettings = {
  display_name: '山田 花子',
  workspace_name: 'ワークスペースA',
  default_tone: '丁寧',
  default_source_type: 'email',
};

const statusLabel: Record<TaskStatus, string> = {
  todo: '未着手',
  doing: '進行中',
  waiting: '待機中',
  done: '完了',
};

const priorityLabel: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const sourceLabel: Record<string, string> = {
  email: 'メール',
  chat: 'チャット',
  meeting: '会議メモ',
  free: '自由入力',
  work: '業務依頼',
};

type ResultSort = 'execution' | 'deadline' | 'priority' | 'source';

const priorityRank: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function baseExecutionCompare(a: Task, b: Task): number {
  if (a.status === 'done' && b.status !== 'done') return 1;
  if (a.status !== 'done' && b.status === 'done') return -1;
  if (a.deadline && b.deadline) {
    const diff = a.deadline.localeCompare(b.deadline);
    if (diff !== 0) return diff;
  } else if (a.deadline) return -1;
  else if (b.deadline) return 1;
  return priorityRank[a.priority] - priorityRank[b.priority];
}

function taskDependencyKey(task: Pick<Task, 'analysis_id' | 'title'>): string {
  return `${task.analysis_id ?? 'manual'}::${task.title}`;
}

function sortTasksByExecutionOrder(tasks: Task[]): Task[] {
  const hasManualOrder = tasks.some((task) => Number.isFinite(task.execution_order) && Number(task.execution_order) > 0);
  if (hasManualOrder) {
    return tasks
      .map((task, index) => ({ task, index, order: Number(task.execution_order) > 0 ? Number(task.execution_order) : Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ task }) => task);
  }

  const byTitle = new Map(tasks.map((task) => [taskDependencyKey(task), task]));
  const depthMemo = new Map<string, number>();

  const depthOf = (task: Task, visiting = new Set<string>()): number => {
    if (depthMemo.has(task.id)) return depthMemo.get(task.id) ?? 0;
    if (!task.prerequisite) return 0;
    if (visiting.has(task.id)) return 0;
    const parent = byTitle.get(`${task.analysis_id ?? 'manual'}::${task.prerequisite}`);
    if (!parent || parent.id === task.id) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(task.id);
    const depth = depthOf(parent, nextVisiting) + 1;
    depthMemo.set(task.id, depth);
    return depth;
  };

  return tasks
    .map((task, index) => ({ task, index, depth: depthOf(task) }))
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      const base = baseExecutionCompare(a.task, b.task);
      return base !== 0 ? base : a.index - b.index;
    })
    .map(({ task }) => task);
}

function assignExecutionOrder(tasks: Task[]): Task[] {
  return tasks.map((task, index) => ({ ...task, execution_order: index + 1 }));
}

function dependencyOrderError(tasks: Task[]): string | null {
  const positions = new Map(tasks.map((task, index) => [taskDependencyKey(task), index]));
  for (const task of tasks) {
    if (!task.prerequisite) continue;
    const parentKey = `${task.analysis_id ?? 'manual'}::${task.prerequisite}`;
    const parentIndex = positions.get(parentKey);
    const taskIndex = positions.get(taskDependencyKey(task));
    if (parentIndex !== undefined && taskIndex !== undefined && parentIndex >= taskIndex) {
      return `「${task.title}」は、前提タスク「${task.prerequisite}」より後に配置してください。`;
    }
  }
  return null;
}

function stripReviewHint(value: string): string {
  return value
    .split(/\s*\/\s*/u)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('要確認：'))
    .join(' / ')
    .trim();
}

function normalizeReviewConfirmation(confirmation: string, assignee: string, deadline: string | null): string {
  const base = stripReviewHint(confirmation);
  const missing: string[] = [];
  if (!assignee || assignee === '未設定') missing.push('担当者を確認');
  if (!deadline) missing.push('期限を確認');
  return missing.length ? `${base ? `${base} / ` : ''}要確認：${missing.join('・')}` : base;
}

function patchWithReviewState(task: Task, patch: Partial<Task>): Partial<Task> {
  if (!('assignee' in patch) && !('deadline' in patch) && !('confirmation' in patch)) return patch;
  const next = { ...task, ...patch };
  return {
    ...patch,
    confirmation: normalizeReviewConfirmation(next.confirmation, next.assignee, next.deadline),
  };
}


function applyClientDependencyStatuses(tasks: Task[]): Task[] {
  const byTitle = new Map(tasks.map((task) => [taskDependencyKey(task), task]));
  return tasks.map((task) => {
    if (!task.prerequisite) return task;
    const parent = byTitle.get(`${task.analysis_id ?? 'manual'}::${task.prerequisite}`);
    if (!parent) return task;
    if (parent.status === 'done') {
      return task.status === 'waiting' ? { ...task, status: 'todo' as TaskStatus } : task;
    }
    return task.status === 'done' ? task : { ...task, status: 'waiting' as TaskStatus };
  });
}

function sortResultTasks(tasks: Task[], sort: ResultSort): Task[] {
  if (sort === 'source') return tasks;
  if (sort === 'execution') return sortTasksByExecutionOrder(tasks);

  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      if (sort === 'priority') {
        const priorityDiff = priorityRank[a.task.priority] - priorityRank[b.task.priority];
        if (priorityDiff !== 0) return priorityDiff;

        if (a.task.deadline && b.task.deadline) {
          const deadlineDiff = a.task.deadline.localeCompare(b.task.deadline);
          if (deadlineDiff !== 0) return deadlineDiff;
        } else if (a.task.deadline) {
          return -1;
        } else if (b.task.deadline) {
          return 1;
        }
      } else {
        if (a.task.deadline && b.task.deadline) {
          const deadlineDiff = a.task.deadline.localeCompare(b.task.deadline);
          if (deadlineDiff !== 0) return deadlineDiff;
        } else if (a.task.deadline) {
          return -1;
        } else if (b.task.deadline) {
          return 1;
        }

        const priorityDiff = priorityRank[a.task.priority] - priorityRank[b.task.priority];
        if (priorityDiff !== 0) return priorityDiff;
      }

      return a.index - b.index;
    })
    .map(({ task }) => task);
}

const navItems: Array<[NavKey, typeof Home]> = [
  ['ホーム', Home],
  ['AI整理', WandSparkles],
  ['タスク一覧', LayoutList],
  ['テンプレート', FileText],
  ['履歴', History],
  ['設定', Settings],
];

function formatDate(value: string | null): string {
  if (!value) return '期限なし';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(date);
}

function parseDbDate(value: string): Date {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value);
  return new Date(value.replace(' ', 'T') + 'Z');
}

function formatTime(value: string): string {
  const date = parseDbDate(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDateTime(value: string): string {
  const date = parseDbDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function OrbLogo({ small = false }: { small?: boolean }) {
  return <span className={small ? 'orb-logo orb-logo--small' : 'orb-logo'} aria-hidden="true" />;
}

interface ComposerProps {
  input: string;
  sourceType: string;
  analyzing: boolean;
  onInput: (value: string) => void;
  onSourceType: (value: string) => void;
  onAnalyze: () => void;
  onSample: () => void;
  large?: boolean;
}

function Composer({ input, sourceType, analyzing, onInput, onSourceType, onAnalyze, onSample, large = false }: ComposerProps) {
  return (
    <article className={`composer-card glass-card ${large ? 'composer-card--large' : ''}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow"><Sparkles size={14} /> Neural Input</span>
          <h1>文章を貼り付ける</h1>
        </div>
        <span className="ai-badge">AIが内容を理解します</span>
      </div>

      <div className="input-toolbar">
        <label>
          種類
          <select value={sourceType} onChange={(event) => onSourceType(event.target.value)}>
            <option value="email">メール</option>
            <option value="chat">チャット</option>
            <option value="meeting">会議メモ</option>
            <option value="work">業務依頼</option>
            <option value="free">自由入力</option>
          </select>
        </label>
        <button onClick={onSample}>サンプルを入力</button>
      </div>

      <div className="textarea-wrap">
        <textarea
          value={input}
          maxLength={5000}
          onChange={(event) => onInput(event.target.value)}
          placeholder={sourceType === 'work' ? '業務依頼や指示文を貼り付けてください…' : 'メール、チャット、会議メモを貼り付けてください…'}
        />
        <span>{input.length} / 5000文字</span>
      </div>

      <button className="primary-button" onClick={onAnalyze} disabled={analyzing}>
        {analyzing ? <LoaderCircle className="spin" size={21} /> : <Sparkles size={21} />}
        {analyzing ? 'AIが整理しています…' : 'AIで整理する'}
      </button>
    </article>
  );
}

interface TaskTableProps {
  tasks: Task[];
  loading: boolean;
  editing: boolean;
  onPatch: (id: string, patch: Partial<Task>) => void | Promise<void>;
  onDelete?: (task: Task) => void;
  onReorder?: (tasks: Task[]) => void | Promise<void>;
  onReorderBlocked?: (message: string) => void;
  reorderable?: boolean;
  highlightedId?: string;
  emptyMessage?: string;
  showExecutionOrder?: boolean;
}

type QuickEditState = { taskId: string; field: 'assignee' | 'deadline' } | null;

function TaskTable({ tasks, loading, editing, onPatch, onDelete, onReorder, onReorderBlocked, reorderable = false, highlightedId, emptyMessage, showExecutionOrder = false }: TaskTableProps) {
  const withActions = Boolean(onDelete);
  const [quickEdit, setQuickEdit] = useState<QuickEditState>(null);
  const [quickValue, setQuickValue] = useState('');
  const [resolvedFields, setResolvedFields] = useState<Set<string>>(() => new Set());
  const [draggedId, setDraggedId] = useState('');
  const [dragTarget, setDragTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  const clearDrag = () => {
    setDraggedId('');
    setDragTarget(null);
  };

  const handleRowDragOver = (event: DragEvent<HTMLDivElement>, taskId: string) => {
    if (!reorderable || !draggedId || draggedId === taskId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDragTarget({ id: taskId, position });
  };

  const handleRowDrop = async (event: DragEvent<HTMLDivElement>, targetId: string) => {
    if (!reorderable || !draggedId || draggedId === targetId) { clearDrag(); return; }
    event.preventDefault();
    const sourceIndex = tasks.findIndex((task) => task.id === draggedId);
    const targetIndex = tasks.findIndex((task) => task.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) { clearDrag(); return; }

    const next = [...tasks];
    const [moved] = next.splice(sourceIndex, 1);
    const targetAfterRemoval = next.findIndex((task) => task.id === targetId);
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const insertIndex = Math.max(0, targetAfterRemoval + (position === 'after' ? 1 : 0));
    next.splice(insertIndex, 0, moved);
    const ordered = assignExecutionOrder(next);
    const dependencyError = dependencyOrderError(ordered);
    clearDrag();
    if (dependencyError) {
      onReorderBlocked?.(dependencyError);
      return;
    }
    await Promise.resolve(onReorder?.(ordered));
  };

  const beginQuickEdit = (task: Task, field: 'assignee' | 'deadline') => {
    setQuickEdit({ taskId: task.id, field });
    setQuickValue(field === 'assignee' ? (task.assignee === '未設定' ? '' : task.assignee) : (task.deadline ?? ''));
  };

  const closeQuickEdit = () => {
    setQuickEdit(null);
    setQuickValue('');
  };

  const commitQuickEdit = async (task: Task) => {
    if (!quickEdit || quickEdit.taskId !== task.id) return;
    const value = quickValue.trim();
    if (quickEdit.field === 'assignee' && !value) return;
    if (quickEdit.field === 'deadline' && !value) return;
    const patch = quickEdit.field === 'assignee' ? { assignee: value } : { deadline: value };
    await Promise.resolve(onPatch(task.id, patch));
    setResolvedFields((current) => {
      const next = new Set(current);
      next.add(`${task.id}:${quickEdit.field}`);
      return next;
    });
    closeQuickEdit();
  };


  const commitDeadlineQuickFix = async (task: Task, value: string) => {
    if (!value) return;
    setQuickValue(value);
    await Promise.resolve(onPatch(task.id, { deadline: value }));
    setResolvedFields((current) => {
      const next = new Set(current);
      next.add(`${task.id}:deadline`);
      return next;
    });
    closeQuickEdit();
  };

  return (
    <div className={`task-table ${withActions ? 'task-table--actions' : ''} ${reorderable ? 'task-table--reorderable' : ''}`} role="table" aria-label="整理されたタスク">
      <div className={`task-row task-row--head ${withActions ? 'task-row--with-actions' : ''}`} role="row">
        <span>タスク</span><span>担当</span><span>期限</span><span>優先度</span><span>状態</span><span>確認事項</span>
        {withActions && <span />}
      </div>

      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" />データを読み込んでいます</div>
      ) : tasks.length === 0 ? (
        <div className="empty-state"><WandSparkles size={28} /><strong>該当するタスクがありません</strong><span>{emptyMessage ?? '文章を貼り付けてAIで整理してみましょう。'}</span></div>
      ) : (
        tasks.map((task, index) => {
          const dependencyLocked = Boolean(task.prerequisite && task.status === 'waiting');
          const assigneeQuickEdit = quickEdit?.taskId === task.id && quickEdit.field === 'assignee';
          const deadlineQuickEdit = quickEdit?.taskId === task.id && quickEdit.field === 'deadline';
          return (
            <div
              className={`task-row ${withActions ? 'task-row--with-actions' : ''} ${task.status === 'done' ? 'task-row--done' : ''} ${dependencyLocked ? 'task-row--blocked' : ''} ${highlightedId === task.id ? 'task-row--highlighted' : ''} ${reorderable ? 'task-row--reorderable' : ''} ${draggedId === task.id ? 'task-row--dragging' : ''} ${dragTarget?.id === task.id ? `task-row--drop-${dragTarget.position}` : ''}`}
              role="row"
              key={task.id}
              onDragOver={(event) => handleRowDragOver(event, task.id)}
              onDrop={(event) => void handleRowDrop(event, task.id)}
            >
              {reorderable && (
                <button
                  type="button"
                  className="drag-handle"
                  draggable
                  onDragStart={(event) => {
                    setDraggedId(task.id);
                    setDragTarget(null);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', task.id);
                  }}
                  onDragEnd={clearDrag}
                  aria-label={`${task.title}の実行順をドラッグして変更`}
                  title="ドラッグして実行順を変更"
                >
                  <GripVertical size={17} />
                </button>
              )}
              <div className="task-title-cell">
                {editing ? (
                  <>
                    <input defaultValue={task.title} onBlur={(event) => { if (event.target.value !== task.title) onPatch(task.id, { title: event.target.value }); }} />
                    <input
                      className="prerequisite-input"
                      defaultValue={task.prerequisite}
                      placeholder="前提タスク（なしの場合は空欄）"
                      onBlur={(event) => { if (event.target.value !== task.prerequisite) onPatch(task.id, { prerequisite: event.target.value }); }}
                    />
                  </>
                ) : <strong>{task.title}</strong>}
                <div className="task-meta-line">
                  {showExecutionOrder && <span className="execution-chip">実行 {index + 1}</span>}
                  <span className="category-chip">{task.category}</span>
                  {!editing && task.prerequisite && <span className="dependency-chip">前提：{task.prerequisite}</span>}
                  {dependencyLocked && <span className="blocked-chip"><Clock3 size={10} />前提タスク待ち</span>}
                </div>
              </div>
              <div className="assignee-cell">
                <span className="mini-avatar">{task.assignee === '未設定' ? '?' : task.assignee.slice(0, 1)}</span>
                {editing ? (
                  <input defaultValue={task.assignee} onBlur={(event) => { if (event.target.value !== task.assignee) onPatch(task.id, { assignee: event.target.value || '未設定' }); }} />
                ) : task.assignee === '未設定' ? (
                  assigneeQuickEdit ? (
                    <div className="quick-fix-editor">
                      <input autoFocus value={quickValue} onChange={(event) => setQuickValue(event.target.value)} placeholder="担当者を入力" onKeyDown={(event) => { if (event.key === 'Enter') void commitQuickEdit(task); if (event.key === 'Escape') closeQuickEdit(); }} />
                      <button type="button" className="quick-fix-save" onClick={() => void commitQuickEdit(task)} aria-label="担当者を保存"><Check size={13} /></button>
                      <button type="button" className="quick-fix-cancel" onClick={closeQuickEdit} aria-label="キャンセル"><X size={12} /></button>
                    </div>
                  ) : (
                    <button type="button" className="missing-field-trigger" onClick={() => beginQuickEdit(task, 'assignee')}><span>未設定</span><span className="review-badge">要確認</span><Pencil size={11} /></button>
                  )
                ) : (
                  <span className="field-value">{task.assignee}{resolvedFields.has(`${task.id}:assignee`) && <span className="resolved-badge">解決済み</span>}</span>
                )}
              </div>
              <div className="deadline-cell">
                {editing ? <input type="date" value={task.deadline ?? ''} onChange={(event) => onPatch(task.id, { deadline: event.target.value || null })} /> : !task.deadline ? (
                  deadlineQuickEdit ? (
                    <div className="quick-fix-editor quick-fix-editor--date">
                      <input autoFocus type="date" value={quickValue} onChange={(event) => void commitDeadlineQuickFix(task, event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') closeQuickEdit(); }} />
                      <button type="button" className="quick-fix-cancel" onClick={closeQuickEdit} aria-label="キャンセル"><X size={12} /></button>
                    </div>
                  ) : (
                    <button type="button" className="missing-field-trigger missing-field-trigger--deadline" onClick={() => beginQuickEdit(task, 'deadline')}><CalendarClock size={14} /><span>期限なし</span><span className="review-badge">要確認</span><Pencil size={11} /></button>
                  )
                ) : (
                  <span className="field-value"><CalendarClock size={15} />{formatDate(task.deadline)}{resolvedFields.has(`${task.id}:deadline`) && <span className="resolved-badge">解決済み</span>}</span>
                )}
              </div>
              <div>
                {editing ? (
                  <select value={task.priority} onChange={(event) => onPatch(task.id, { priority: event.target.value as Priority })}>
                    <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
                  </select>
                ) : <span className={`priority priority--${task.priority}`}>{priorityLabel[task.priority]}</span>}
              </div>
              <div>
                <select
                  className={`status-select status-select--${task.status}`}
                  value={task.status}
                  disabled={dependencyLocked}
                  title={dependencyLocked ? `「${task.prerequisite}」が完了すると自動的に未着手へ切り替わります` : undefined}
                  onChange={(event) => onPatch(task.id, { status: event.target.value as TaskStatus })}
                >
                  {Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </div>
              <div className="confirmation-cell">
                {editing ? <input defaultValue={task.confirmation} onBlur={(event) => { if (event.target.value !== task.confirmation) onPatch(task.id, { confirmation: event.target.value }); }} /> : task.confirmation || '—'}
              </div>
              {withActions && (
                <button className="row-delete" onClick={() => onDelete?.(task)} aria-label={`${task.title}を削除`} title="削除">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

interface DraftAnalysisState extends AnalysisResponse {
  sourceText: string;
  sourceType: string;
  tone: string;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow"><Sparkles size={14} /> {eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(initialDashboard);
  const [input, setInput] = useState(sampleText);
  const [sourceType, setSourceType] = useState('email');
  const [tone, setTone] = useState('丁寧');
  const [activeNav, setActiveNav] = useState<NavKey>('ホーム');
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [draftAnalysis, setDraftAnalysis] = useState<DraftAnalysisState | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const [globalSearch, setGlobalSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Task[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [taskResults, setTaskResults] = useState<Task[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskStatus, setTaskStatus] = useState('');
  const [taskPriority, setTaskPriority] = useState('');
  const [taskReviewOnly, setTaskReviewOnly] = useState(false);
  const [taskSort, setTaskSort] = useState('execution');
  const [resultSort, setResultSort] = useState<ResultSort>('execution');
  const [highlightedTaskId, setHighlightedTaskId] = useState('');

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateEditor, setTemplateEditor] = useState({
    open: false,
    id: '',
    title: '',
    description: '',
    source_type: 'email',
    content: '',
  });
  const [templateSaving, setTemplateSaving] = useState(false);

  const [historyData, setHistoryData] = useState<HistoryData>(initialHistory);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [settingsData, setSettingsData] = useState<AppSettings>(initialSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      setError('');
      const data = await api.getDashboard();
      setDashboard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データを読み込めませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTaskList = useCallback(async () => {
    setTaskLoading(true);
    try {
      const result = await api.listTasks({
        q: taskQuery,
        status: taskStatus,
        priority: taskPriority,
        review: taskReviewOnly ? '1' : '',
        sort: taskSort,
        limit: 200,
      });
      setTaskResults(result.tasks);
      setTaskTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タスクを読み込めませんでした');
    } finally {
      setTaskLoading(false);
    }
  }, [taskPriority, taskQuery, taskReviewOnly, taskSort, taskStatus]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      setTemplates(await api.listTemplates());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'テンプレートを読み込めませんでした');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistoryData(await api.getHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : '履歴を読み込めませんでした');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    void api.getSettings().then((value) => {
      setSettingsData(value);
      setTone(value.default_tone);
      setSourceType(value.default_source_type);
    }).catch(() => undefined);
  }, [loadDashboard]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (activeNav !== 'タスク一覧') return;
    const timer = window.setTimeout(() => void loadTaskList(), 220);
    return () => window.clearTimeout(timer);
  }, [activeNav, loadTaskList]);

  useEffect(() => {
    if (activeNav === 'テンプレート') void loadTemplates();
    if (activeNav === '履歴') void loadHistory();
  }, [activeNav, loadHistory, loadTemplates]);

  useEffect(() => {
    const query = globalSearch.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void api.listTasks({ q: query, limit: 8 }).then((result) => {
        setSearchResults(result.tasks);
        setSearchLoading(false);
      }).catch(() => setSearchLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [globalSearch]);

  const navigate = (nav: NavKey) => {
    setActiveNav(nav);
    setMobileMenu(false);
    setError('');
  };

  const openTaskSearch = (query: string, selectedId = '') => {
    setTaskQuery(query.trim());
    setGlobalSearch(query.trim());
    setHighlightedTaskId(selectedId);
    setSearchOpen(false);
    navigate('タスク一覧');
    if (selectedId) window.setTimeout(() => setHighlightedTaskId(''), 3200);
  };

  const handleAnalyze = async () => {
    const sourceText = input.trim();
    if (sourceText.length < 8) {
      setError('整理する文章を8文字以上入力してください。');
      return;
    }

    setAnalyzing(true);
    setError('');
    try {
      const result = await api.analyze({ text: sourceText, sourceType, tone });
      // AIが提案した実行順を初期値として保持し、ドラッグ＆ドロップで人が上書きできるようにする。
      const orderedTasks = assignExecutionOrder(sortTasksByExecutionOrder(result.tasks.map((task) => ({ ...task, execution_order: null }))));
      // 未保存のAI結果は追加せず、毎回まるごと置き換える。
      setDraftAnalysis({ ...result, tasks: orderedTasks, sourceText, sourceType, tone });
      setEditing(false);
      showToast(`${result.tasks.length}件を整理しました。内容を確認して保存してください`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI整理に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  const patchDraftTask = (id: string, patch: Partial<Task>) => {
    setDraftAnalysis((current) => {
      if (!current) return current;
      const patched = current.tasks.map((task) => task.id === id ? { ...task, ...patchWithReviewState(task, patch) } : task);
      return { ...current, tasks: applyClientDependencyStatuses(patched) };
    });
  };

  const reorderDraftTasks = (orderedTasks: Task[]) => {
    setDraftAnalysis((current) => current ? { ...current, tasks: applyClientDependencyStatuses(orderedTasks) } : current);
    showToast('実行順を変更しました。保存するとこの順番でD1に登録されます');
  };

  const saveDraftAnalysis = async () => {
    if (!draftAnalysis || draftAnalysis.tasks.length === 0) return;

    setSavingDraft(true);
    setError('');
    try {
      const saved = await api.saveAnalysis({
        analysisId: draftAnalysis.analysisId,
        text: draftAnalysis.sourceText,
        sourceType: draftAnalysis.sourceType,
        tone: draftAnalysis.tone,
        replyDraft: draftAnalysis.replyDraft,
        model: draftAnalysis.model,
        tasks: draftAnalysis.tasks,
      });
      setDraftAnalysis(null);
      setEditing(false);
      await loadDashboard();
      if (activeNav === 'タスク一覧') await loadTaskList();
      showToast(`${saved.tasks.length}件のタスクをD1へ保存しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タスクを保存できませんでした');
    } finally {
      setSavingDraft(false);
    }
  };

  const patchTask = async (id: string, patch: Partial<Task>) => {
    const beforeDashboard = dashboard;
    const beforeTasks = taskResults;
    const sourceTask = taskResults.find((task) => task.id === id) ?? dashboard.tasks.find((task) => task.id === id);
    const normalizedPatch = sourceTask ? patchWithReviewState(sourceTask, patch) : patch;
    const patchList = (tasks: Task[]) => tasks.map((task) => (task.id === id ? { ...task, ...normalizedPatch } : task));
    setDashboard((current) => ({ ...current, tasks: patchList(current.tasks) }));
    setTaskResults((current) => patchList(current));

    try {
      await api.updateTask(id, normalizedPatch);
      await loadDashboard();
      if (activeNav === 'タスク一覧') await loadTaskList();
      if (patch.status === 'done') showToast('完了に更新しました。後続タスクの待機状態も自動判定しました');
    } catch (err) {
      setDashboard(beforeDashboard);
      setTaskResults(beforeTasks);
      setError(err instanceof Error ? err.message : 'タスクを更新できませんでした');
    }
  };

  const reorderSavedTasks = async (orderedTasks: Task[]) => {
    const beforeTasks = taskResults;
    const orderedIds = orderedTasks.map((task) => task.id);
    setTaskResults(orderedTasks);
    try {
      await api.reorderTasks(orderedIds);
      await Promise.all([loadDashboard(), loadTaskList()]);
      showToast('実行順を保存しました');
    } catch (err) {
      setTaskResults(beforeTasks);
      setError(err instanceof Error ? err.message : '実行順を保存できませんでした');
    }
  };

  const addTask = async () => {
    try {
      await api.createTask({
        title: '新しいタスク',
        assignee: '未設定',
        priority: 'medium',
        category: '手動追加',
        confirmation: '',
        prerequisite: '',
        deadline: null,
      });
      await loadDashboard();
      if (activeNav === 'タスク一覧') await loadTaskList();
      setEditing(true);
      showToast('タスクを追加しました。編集モードで内容を変更できます');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タスクを追加できませんでした');
    }
  };

  const deleteTask = async (task: Task) => {
    if (!window.confirm(`「${task.title}」を削除しますか？`)) return;
    try {
      await api.deleteTask(task.id);
      await loadDashboard();
      await loadTaskList();
      showToast('タスクを削除しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タスクを削除できませんでした');
    }
  };

  const copyText = async (text: string, message: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    showToast(message);
  };

  const useTemplate = (template: Template) => {
    setDraftAnalysis(null);
    setInput(template.content);
    setSourceType(template.source_type);
    navigate('AI整理');
    showToast(`「${template.title}」を入力欄に反映しました`);
  };

  const openTemplateEditor = (template?: Template) => {
    setTemplateEditor({
      open: true,
      id: template?.id ?? '',
      title: template?.title ?? '',
      description: template?.description ?? '',
      source_type: template?.source_type ?? 'email',
      content: template?.content ?? '',
    });
  };

  const saveTemplate = async () => {
    if (!templateEditor.title.trim() || !templateEditor.content.trim()) {
      setError('テンプレート名と本文を入力してください。');
      return;
    }
    setTemplateSaving(true);
    try {
      const payload = {
        title: templateEditor.title.trim(),
        description: templateEditor.description.trim(),
        source_type: templateEditor.source_type,
        content: templateEditor.content.trim(),
      };
      if (templateEditor.id) await api.updateTemplate(templateEditor.id, payload);
      else await api.createTemplate(payload);
      setTemplateEditor((current) => ({ ...current, open: false }));
      await loadTemplates();
      showToast(templateEditor.id ? 'テンプレートを更新しました' : 'テンプレートを作成しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'テンプレートを保存できませんでした');
    } finally {
      setTemplateSaving(false);
    }
  };

  const toggleFavorite = async (template: Template) => {
    try {
      await api.updateTemplate(template.id, { is_favorite: template.is_favorite ? 0 : 1 });
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'お気に入りを変更できませんでした');
    }
  };

  const removeTemplate = async (template: Template) => {
    if (!window.confirm(`テンプレート「${template.title}」を削除しますか？`)) return;
    try {
      await api.deleteTemplate(template.id);
      await loadTemplates();
      showToast('テンプレートを削除しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'テンプレートを削除できませんでした');
    }
  };

  const reuseHistory = (item: AnalysisHistoryItem) => {
    setDraftAnalysis(null);
    setInput(item.source_text);
    setSourceType(item.source_type);
    setTone(item.tone);
    navigate('AI整理');
    showToast('過去の入力内容を復元しました');
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      const saved = await api.updateSettings(settingsData);
      setSettingsData(saved);
      setTone(saved.default_tone);
      setSourceType(saved.default_source_type);
      showToast('設定を保存しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '設定を保存できませんでした');
    } finally {
      setSettingsSaving(false);
    }
  };

  const summaryCards = useMemo(
    () => [
      { label: '本日のタスク', value: `${dashboard.summary.today}件`, detail: '今日までに対応', icon: <LayoutList size={20} />, tone: 'blue' },
      { label: '期限間近', value: `${dashboard.summary.urgent}件`, detail: '3日以内', icon: <Clock3 size={20} />, tone: 'coral' },
      { label: '待機中', value: `${dashboard.summary.waiting}件`, detail: '前提タスク・確認待ち', icon: <CircleUserRound size={20} />, tone: 'mint' },
      { label: '完了率', value: `${dashboard.summary.completionRate}%`, detail: '登録タスク全体', icon: <Check size={20} />, tone: 'violet' },
    ],
    [dashboard.summary],
  );

  const rawResultTasks = draftAnalysis?.tasks ?? dashboard.tasks;
  const resultTasks = useMemo(() => sortResultTasks(rawResultTasks, resultSort), [rawResultTasks, resultSort]);
  const resultReplyDraft = draftAnalysis?.replyDraft ?? dashboard.latestReplyDraft;
  const resultLoading = draftAnalysis ? false : loading;
  const displayTaskResults = useMemo(
    () => taskSort === 'execution' ? sortTasksByExecutionOrder(taskResults) : taskResults,
    [taskResults, taskSort],
  );
  const taskListHasFilters = Boolean(taskQuery || taskStatus || taskPriority || taskReviewOnly);
  const canReorderTaskList = taskSort === 'execution' && !taskListHasFilters && taskResults.length === taskTotal;
  const patchResultTask = async (id: string, patch: Partial<Task>) => {
    if (draftAnalysis) patchDraftTask(id, patch);
    else await patchTask(id, patch);
  };

  const renderDraftActions = () => draftAnalysis ? (
    <div className="draft-save-bar">
      <div className="draft-save-message">
        <span className="unsaved-badge">未保存</span>
        <span className="analysis-engine-badge">{draftAnalysis.model === 'fallback-parser' ? '簡易解析 + ルール補正' : 'Workers AI + ルール補正'}</span>
        <span>この整理結果はまだD1に保存されていません。生成し直すと、この未保存結果だけが置き換わります。</span>
      </div>
      <div className="draft-save-actions">
        <button className="secondary-button" onClick={() => void handleAnalyze()} disabled={analyzing || savingDraft}>
          {analyzing ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
          {analyzing ? '生成中…' : '生成し直す'}
        </button>
        <button className="page-primary" onClick={() => void saveDraftAnalysis()} disabled={savingDraft || analyzing}>
          {savingDraft ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {savingDraft ? '保存中…' : `${draftAnalysis.tasks.length}件を保存`}
        </button>
      </div>
    </div>
  ) : null;

  const renderSummary = () => (
    <section className="summary-section">
      <div className="summary-title"><span>サマリー</span><small>リアルタイム</small></div>
      <div className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={`summary-card glass-card summary-card--${card.tone}`}>
            <div className="summary-card__top"><span>{card.label}</span><span className="summary-icon">{card.icon}</span></div>
            <strong>{loading ? '—' : card.value}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </div>
    </section>
  );

  const renderReplyPanel = () => (
    <article className="reply-panel glass-card">
      <div className="panel-header panel-header--compact">
        <div><span className="eyebrow"><MessageSquareText size={14} /> Smart Reply</span><h2>返信文の下書き</h2></div>
        <div className="reply-actions">
          {draftAnalysis && <span className="unsaved-badge">未保存</span>}
          <select value={tone} onChange={(event) => setTone(event.target.value)} aria-label="返信文のトーン">
            <option>丁寧</option><option>簡潔</option><option>やわらかい</option>
          </select>
          <button onClick={() => void copyText(resultReplyDraft, '返信文をコピーしました')}><Clipboard size={15} />コピー</button>
        </div>
      </div>
      <div className="reply-content">
        {resultReplyDraft || 'AI整理を実行すると、ここに返信文の下書きが表示されます。'}
        <div className="reply-sparkle"><Sparkles size={16} /> AIが作成</div>
      </div>
    </article>
  );

  const renderLogPanel = (limit = 8) => (
    <article className="log-panel glass-card">
      <div className="panel-header panel-header--compact">
        <div><span className="eyebrow"><History size={14} /> Activity</span><h2>AI整理ログ</h2></div>
        <button className="text-button" onClick={() => navigate('履歴')}>すべて表示</button>
      </div>
      <div className="timeline">
        {dashboard.activities.length === 0 ? <div className="log-empty">整理ログはまだありません</div> : dashboard.activities.slice(0, limit).map((log, index) => (
          <div className="timeline-item" key={log.id}>
            <time>{formatTime(log.created_at)}</time>
            <span className={`timeline-dot timeline-dot--${index % 4}`} />
            <div><strong>{log.action}</strong><small>{log.detail}</small></div>
          </div>
        ))}
      </div>
    </article>
  );

  const renderHome = () => (
    <>
      <section className="hero-grid">
        <Composer input={input} sourceType={sourceType} analyzing={analyzing} onInput={setInput} onSourceType={setSourceType} onAnalyze={handleAnalyze} onSample={() => { if (sourceType === 'work') { setInput(workRequestSample); } else { setInput(sampleText); setSourceType('meeting'); } }} />
        {renderSummary()}
      </section>
      <section className="workspace-grid">
        <article className="task-panel glass-card">
          <div className="panel-header">
            <div><span className="eyebrow"><LayoutList size={14} /> Structured Tasks</span><h2>整理結果（タスク）</h2></div>
            <div className="panel-actions">
              {draftAnalysis && <span className="unsaved-badge">未保存</span>}
              <span className="count-badge">{resultTasks.length}件</span>
              <label className="result-sort">
                <span>並び順</span>
                <select value={resultSort} onChange={(event) => setResultSort(event.target.value as ResultSort)} aria-label="整理結果の並び順">
                  <option value="execution">実行順</option>
                  <option value="deadline">期限順</option>
                  <option value="priority">優先度順</option>
                  <option value="source">原文順</option>
                </select>
              </label>
              <button className={editing ? 'toggle toggle--on' : 'toggle'} onClick={() => setEditing((value) => !value)} aria-label="編集モード"><span /></button>
              <small>編集</small>
            </div>
          </div>
          {draftAnalysis && resultSort === 'execution' && !editing && <div className="drag-reorder-hint"><GripVertical size={14} />左のハンドルをドラッグして、実際の業務に合わせて実行順を変更できます</div>}
          <TaskTable
            tasks={resultTasks}
            loading={resultLoading}
            editing={editing}
            onPatch={patchResultTask}
            onReorder={draftAnalysis ? reorderDraftTasks : undefined}
            onReorderBlocked={(message) => showToast(message)}
            reorderable={Boolean(draftAnalysis) && resultSort === 'execution' && !editing}
            showExecutionOrder={resultSort === 'execution'}
          />
          {draftAnalysis ? renderDraftActions() : <button className="add-task" onClick={() => void addTask()}><Plus size={17} />手動でタスクを追加</button>}
        </article>
        <aside className="right-column">
          {renderReplyPanel()}
          {renderLogPanel()}
        </aside>
      </section>
    </>
  );

  const renderAiPage = () => (
    <>
      <PageHeading eyebrow="AI Workspace" title="AI整理" description="文章をタスク化し、前提関係から実行順・待機状態まで整理します。AIの提案順はドラッグ＆ドロップで業務に合わせて調整できます。" />
      <section className="ai-page-grid">
        <Composer large input={input} sourceType={sourceType} analyzing={analyzing} onInput={setInput} onSourceType={setSourceType} onAnalyze={handleAnalyze} onSample={() => { if (sourceType === 'work') { setInput(workRequestSample); } else { setInput(sampleText); setSourceType('meeting'); } }} />
        <article className="ai-guide-card glass-card">
          <span className="eyebrow"><BookOpen size={14} /> How it works</span>
          <h2>依頼を実行順まで整理</h2>
          <div className="guide-steps">
            <div><span>01</span><p><strong>依頼を分解</strong>複数の依頼を1タスクずつ整理</p></div>
            <div><span>02</span><p><strong>期限・担当を特定</strong>明記されていない箇所は未設定で保持</p></div>
            <div><span>03</span><p><strong>前提タスクを判定</strong>「確認後に送付」など作業の前後関係を整理</p></div>
            <div><span>04</span><p><strong>実行順を整理</strong>AIの提案後、ドラッグ＆ドロップで実務順に調整</p></div>
            <div><span>05</span><p><strong>待機状態を制御</strong>前提が未完了なら待機中、完了すると自動解除</p></div>
            <div><span>06</span><p><strong>不足情報を補完</strong>担当者・期限の「要確認」をその場で修正</p></div>
          </div>
          <button className="secondary-button" onClick={() => navigate('テンプレート')}><FileText size={16} />テンプレートから始める</button>
        </article>
      </section>
      <section className="ai-result-grid">
        <article className="task-panel glass-card">
          <div className="panel-header">
            <div><span className="eyebrow"><LayoutList size={14} /> Latest Result</span><h2>最新の整理結果</h2></div>
            <div className="panel-actions">
              {draftAnalysis && <span className="unsaved-badge">未保存</span>}
              <span className="count-badge">{resultTasks.length}件</span>
              <label className="result-sort">
                <span>並び順</span>
                <select value={resultSort} onChange={(event) => setResultSort(event.target.value as ResultSort)} aria-label="最新の整理結果の並び順">
                  <option value="execution">実行順</option>
                  <option value="deadline">期限順</option>
                  <option value="priority">優先度順</option>
                  <option value="source">原文順</option>
                </select>
              </label>
            </div>
          </div>
          {draftAnalysis && resultSort === 'execution' && !editing && <div className="drag-reorder-hint"><GripVertical size={14} />左のハンドルをドラッグして、実際の業務に合わせて実行順を変更できます</div>}
          <TaskTable
            tasks={resultTasks}
            loading={resultLoading}
            editing={editing}
            onPatch={patchResultTask}
            onReorder={draftAnalysis ? reorderDraftTasks : undefined}
            onReorderBlocked={(message) => showToast(message)}
            reorderable={Boolean(draftAnalysis) && resultSort === 'execution' && !editing}
            showExecutionOrder={resultSort === 'execution'}
          />
          {draftAnalysis ? renderDraftActions() : (
            <div className="result-actions">
              <button className="secondary-button" onClick={() => setEditing((value) => !value)}><Pencil size={15} />{editing ? '編集を終了' : '結果を編集'}</button>
              <button className="secondary-button" onClick={() => navigate('タスク一覧')}>すべてのタスクを見る<ChevronRight size={15} /></button>
            </div>
          )}
        </article>
        {renderReplyPanel()}
      </section>
    </>
  );

  const renderTaskPage = () => (
    <>
      <PageHeading
        eyebrow="Task Database"
        title="タスク一覧"
        description="D1に保存されたタスクを検索・絞り込み・編集できます。"
        action={<button className="page-primary" onClick={() => void addTask()}><Plus size={17} />タスクを追加</button>}
      />
      <section className="filter-panel glass-card">
        <div className="quick-filter-row" aria-label="クイックフィルター">
          <span>クイック表示</span>
          <button className={!taskReviewOnly && !taskStatus ? 'quick-filter-button quick-filter-button--active' : 'quick-filter-button'} onClick={() => { setTaskReviewOnly(false); setTaskStatus(''); }}>すべて</button>
          <button className={taskReviewOnly ? 'quick-filter-button quick-filter-button--active quick-filter-button--review' : 'quick-filter-button'} onClick={() => { setTaskReviewOnly(true); setTaskStatus(''); }}>要確認のみ</button>
          <button className={!taskReviewOnly && taskStatus === 'waiting' ? 'quick-filter-button quick-filter-button--active' : 'quick-filter-button'} onClick={() => { setTaskReviewOnly(false); setTaskStatus('waiting'); }}>待機中</button>
          <button className={!taskReviewOnly && taskStatus === 'todo' ? 'quick-filter-button quick-filter-button--active' : 'quick-filter-button'} onClick={() => { setTaskReviewOnly(false); setTaskStatus('todo'); }}>未着手</button>
          <button className={!taskReviewOnly && taskStatus === 'done' ? 'quick-filter-button quick-filter-button--active' : 'quick-filter-button'} onClick={() => { setTaskReviewOnly(false); setTaskStatus('done'); }}>完了</button>
        </div>
        <label className="filter-search"><Search size={17} /><input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="タスク名・担当者・カテゴリ・確認事項を検索" /></label>
        <label><Filter size={15} /><select value={taskStatus} onChange={(event) => { setTaskReviewOnly(false); setTaskStatus(event.target.value); }}><option value="">すべての状態</option>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><SlidersHorizontal size={15} /><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)}><option value="">すべての優先度</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
        <button className="filter-reset" onClick={() => { setTaskQuery(''); setTaskStatus(''); setTaskPriority(''); setTaskReviewOnly(false); setTaskSort('execution'); }}><RotateCcw size={15} />リセット</button>
      </section>
      <article className="task-panel task-panel--page glass-card">
        <div className="panel-header">
          <div><span className="eyebrow"><LayoutList size={14} /> Search Result</span><h2>{taskQuery ? `「${taskQuery}」の検索結果` : 'すべてのタスク'}</h2></div>
          <div className="panel-actions">
            <span className="count-badge">{taskTotal}件</span>
            <label className="result-sort">
              <span>並び順</span>
              <select value={taskSort} onChange={(event) => setTaskSort(event.target.value)} aria-label="タスク一覧の並び順">
                <option value="execution">実行順</option>
                <option value="deadline">期限順</option>
                <option value="priority">優先度順</option>
                <option value="newest">新しい順</option>
                <option value="oldest">古い順</option>
              </select>
            </label>
            <button className={editing ? 'toggle toggle--on' : 'toggle'} onClick={() => setEditing((value) => !value)} aria-label="編集モード"><span /></button>
            <small>編集</small>
          </div>
        </div>
        {taskSort === 'execution' && !editing && (
          <div className={`drag-reorder-hint ${canReorderTaskList ? '' : 'drag-reorder-hint--disabled'}`}>
            <GripVertical size={14} />
            {canReorderTaskList
              ? 'ドラッグ＆ドロップで実行順を変更できます。変更はD1に保存されます'
              : '保存済みタスクの並べ替えは、検索・絞り込みを解除して「すべて」を表示すると利用できます'}
          </div>
        )}
        <TaskTable
          tasks={displayTaskResults}
          loading={taskLoading}
          editing={editing}
          onPatch={patchTask}
          onDelete={(task) => void deleteTask(task)}
          onReorder={canReorderTaskList ? reorderSavedTasks : undefined}
          onReorderBlocked={(message) => showToast(message)}
          reorderable={canReorderTaskList && !editing}
          highlightedId={highlightedTaskId}
          emptyMessage="検索条件を変更するか、新しいタスクを追加してください。"
          showExecutionOrder={taskSort === 'execution'}
        />
      </article>
    </>
  );

  const renderTemplatesPage = () => (
    <>
      <PageHeading
        eyebrow="Reusable Inputs"
        title="テンプレート"
        description="繰り返し使う依頼文や会議メモの型をD1に保存し、ワンクリックでAI整理へ送れます。"
        action={<button className="page-primary" onClick={() => openTemplateEditor()}><Plus size={17} />新規テンプレート</button>}
      />
      {templatesLoading ? <div className="page-loading"><LoaderCircle className="spin" />テンプレートを読み込んでいます</div> : (
        <section className="template-grid">
          {templates.map((template) => (
            <article className="template-card glass-card" key={template.id}>
              <div className="template-card__top">
                <span className="template-type">{template.source_type === 'email' ? <Mail size={14} /> : template.source_type === 'chat' ? <MessagesSquare size={14} /> : template.source_type === 'work' ? <BriefcaseBusiness size={14} /> : <NotebookText size={14} />}{sourceLabel[template.source_type] ?? template.source_type}</span>
                <button className={`favorite-button ${template.is_favorite ? 'favorite-button--on' : ''}`} onClick={() => void toggleFavorite(template)} aria-label="お気に入り"><Star size={17} fill={template.is_favorite ? 'currentColor' : 'none'} /></button>
              </div>
              <h2>{template.title}</h2>
              <p>{template.description || '説明は設定されていません。'}</p>
              <div className="template-preview">{template.content}</div>
              <div className="template-actions">
                <button className="template-use" onClick={() => useTemplate(template)}><WandSparkles size={15} />この文章を使う</button>
                <button onClick={() => openTemplateEditor(template)} aria-label="編集"><Pencil size={15} /></button>
                <button onClick={() => void removeTemplate(template)} aria-label="削除"><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
          {templates.length === 0 && <div className="empty-page glass-card"><FileText size={32} /><h2>テンプレートがありません</h2><p>よく使う依頼文を登録して、AI整理をすぐ始められるようにしましょう。</p></div>}
        </section>
      )}
    </>
  );

  const renderHistoryPage = () => (
    <>
      <PageHeading eyebrow="Analysis Archive" title="履歴" description="AI整理した原文・返信文・抽出件数と、アプリ上の操作ログを確認できます。" />
      {historyLoading ? <div className="page-loading"><LoaderCircle className="spin" />履歴を読み込んでいます</div> : (
        <section className="history-layout">
          <div className="history-list">
            {historyData.analyses.map((item) => (
              <article className="history-card glass-card" key={item.id}>
                <div className="history-card__meta">
                  <span>{sourceLabel[item.source_type] ?? item.source_type}</span>
                  <time>{formatDateTime(item.created_at)}</time>
                  <span>{item.task_count}件抽出</span>
                </div>
                <h2>{item.source_text.slice(0, 64)}{item.source_text.length > 64 ? '…' : ''}</h2>
                <p>{item.source_text}</p>
                <div className="history-card__footer">
                  <small>トーン：{item.tone}　モデル：{item.model === 'fallback-parser' ? '簡易解析' : 'Workers AI'}</small>
                  <div><button onClick={() => reuseHistory(item)}><RotateCcw size={14} />入力へ戻す</button><button onClick={() => void copyText(item.reply_draft, '返信文をコピーしました')}><Clipboard size={14} />返信文</button></div>
                </div>
              </article>
            ))}
            {historyData.analyses.length === 0 && <div className="empty-page glass-card"><History size={32} /><h2>AI整理の履歴がありません</h2></div>}
          </div>
          <article className="history-log glass-card">
            <div className="panel-header panel-header--compact"><div><span className="eyebrow"><History size={14} /> Full Activity</span><h2>操作ログ</h2></div><span className="count-badge">{historyData.activities.length}件</span></div>
            <div className="timeline timeline--full">
              {historyData.activities.map((log, index) => (
                <div className="timeline-item" key={log.id}><time>{formatDateTime(log.created_at)}</time><span className={`timeline-dot timeline-dot--${index % 4}`} /><div><strong>{log.action}</strong><small>{log.detail}</small></div></div>
              ))}
            </div>
          </article>
        </section>
      )}
    </>
  );

  const renderSettingsPage = () => (
    <>
      <PageHeading eyebrow="Workspace Preferences" title="設定" description="表示名やワークスペース名、AI整理の初期値をD1へ保存します。" />
      <section className="settings-layout">
        <article className="settings-card glass-card">
          <div className="settings-icon"><BriefcaseBusiness size={22} /></div>
          <div><h2>プロフィールとワークスペース</h2><p>画面上部に表示される名称を設定します。</p></div>
          <label>表示名<input value={settingsData.display_name} onChange={(event) => setSettingsData((current) => ({ ...current, display_name: event.target.value }))} /></label>
          <label>ワークスペース名<input value={settingsData.workspace_name} onChange={(event) => setSettingsData((current) => ({ ...current, workspace_name: event.target.value }))} /></label>
        </article>
        <article className="settings-card glass-card">
          <div className="settings-icon"><WandSparkles size={22} /></div>
          <div><h2>AI整理の初期設定</h2><p>新しく開いたときの文章種類と返信トーンです。</p></div>
          <label>初期の文章種類<select value={settingsData.default_source_type} onChange={(event) => setSettingsData((current) => ({ ...current, default_source_type: event.target.value }))}><option value="email">メール</option><option value="chat">チャット</option><option value="meeting">会議メモ</option><option value="work">業務依頼</option><option value="free">自由入力</option></select></label>
          <label>初期の返信トーン<select value={settingsData.default_tone} onChange={(event) => setSettingsData((current) => ({ ...current, default_tone: event.target.value }))}><option>丁寧</option><option>簡潔</option><option>やわらかい</option></select></label>
        </article>
        <article className="settings-info glass-card">
          <Sparkles size={22} />
          <div><h2>D1で同期されます</h2><p>設定はブラウザのlocalStorageではなくD1に保存されるため、デプロイ先でも同じ設定を利用できます。</p></div>
        </article>
      </section>
      <div className="settings-save"><button className="page-primary" onClick={() => void saveSettings()} disabled={settingsSaving}>{settingsSaving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{settingsSaving ? '保存しています…' : '設定を保存'}</button></div>
    </>
  );

  const pageContent = activeNav === 'ホーム' ? renderHome()
    : activeNav === 'AI整理' ? renderAiPage()
      : activeNav === 'タスク一覧' ? renderTaskPage()
        : activeNav === 'テンプレート' ? renderTemplatesPage()
          : activeNav === '履歴' ? renderHistoryPage()
            : renderSettingsPage();

  return (
    <div className="app-shell">
      <div className="ambient ambient--one" /><div className="ambient ambient--two" /><div className="ambient ambient--three" />

      <aside className={`sidebar ${mobileMenu ? 'sidebar--open' : ''}`}>
        <div className="brand">
          <OrbLogo />
          <div><strong>TaskPalette</strong><span>AI業務整理ツール</span></div>
          <button className="sidebar-close" onClick={() => setMobileMenu(false)} aria-label="メニューを閉じる"><X size={20} /></button>
        </div>
        <nav className="nav-list" aria-label="メインメニュー">
          {navItems.map(([label, Icon]) => (
            <button key={label} className={activeNav === label ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => navigate(label)}>
              <Icon size={19} /><span>{label}</span>
              {label === 'タスク一覧' && dashboard.summary.urgent > 0 && <em>{dashboard.summary.urgent}</em>}
            </button>
          ))}
        </nav>
        <div className="assistant-card glass-card">
          <div className="assistant-card__title">AIアシスタント</div>
          <div className="assistant-card__body"><div className="bot-face"><Bot size={22} /></div><p>文章の中にある<br />「やること」を整えます。</p></div>
          <div className="online"><span />オンライン</div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileMenu(true)} aria-label="メニューを開く"><Menu size={22} /></button>
          <div className="mobile-brand"><OrbLogo small /><strong>TaskPalette</strong></div>
          <div className="search-area">
            <label className="search-box">
              <Search size={17} />
              <input
                ref={searchInputRef}
                value={globalSearch}
                placeholder="タスクを検索"
                aria-label="タスクを検索"
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => { setGlobalSearch(event.target.value); setSearchOpen(true); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openTaskSearch(globalSearch);
                  if (event.key === 'Escape') setSearchOpen(false);
                }}
              />
              {globalSearch ? <button className="search-clear" onClick={() => { setGlobalSearch(''); setSearchResults([]); }} aria-label="検索をクリア"><X size={14} /></button> : <kbd>Ctrl K</kbd>}
            </label>
            {searchOpen && globalSearch.trim() && (
              <div className="search-popover">
                <div className="search-popover__head"><span>タスク検索</span><button onClick={() => openTaskSearch(globalSearch)}>すべて表示<ChevronRight size={14} /></button></div>
                {searchLoading ? <div className="search-state"><LoaderCircle className="spin" size={17} />検索しています</div> : searchResults.length === 0 ? <div className="search-state">該当するタスクはありません</div> : searchResults.map((task) => (
                  <button className="search-result" key={task.id} onClick={() => openTaskSearch(globalSearch, task.id)}>
                    <span className={`search-result__status search-result__status--${task.status}`} />
                    <span><strong>{task.title}</strong><small>{task.assignee}・{task.category}・{formatDate(task.deadline)}</small></span>
                    <span className={`priority priority--${task.priority}`}>{priorityLabel[task.priority]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="期限間近のタスク" onClick={() => { setTaskStatus(''); setTaskSort('deadline'); navigate('タスク一覧'); }}><Bell size={19} />{dashboard.summary.urgent > 0 && <span className="notice-count">{dashboard.summary.urgent}</span>}</button>
            <button className="user-box" onClick={() => navigate('設定')}>
              <div className="avatar">{settingsData.display_name.trim().slice(0, 1) || 'Y'}</div>
              <div><strong>{settingsData.display_name}</strong><span>{settingsData.workspace_name}</span></div>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <div className="content">
          {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
          {pageContent}
        </div>
      </main>

      {mobileMenu && <button className="sidebar-backdrop" onClick={() => setMobileMenu(false)} aria-label="メニューを閉じる" />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}

      {templateEditor.open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setTemplateEditor((current) => ({ ...current, open: false }))}>
          <section className="template-modal glass-card" role="dialog" aria-modal="true" aria-label="テンプレート編集" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><span className="eyebrow"><FileText size={14} /> Template Editor</span><h2>{templateEditor.id ? 'テンプレートを編集' : '新しいテンプレート'}</h2></div><button onClick={() => setTemplateEditor((current) => ({ ...current, open: false }))}><X size={19} /></button></div>
            <div className="modal-form">
              <label>テンプレート名<input value={templateEditor.title} onChange={(event) => setTemplateEditor((current) => ({ ...current, title: event.target.value }))} placeholder="例：週次報告の整理" /></label>
              <label>説明<input value={templateEditor.description} onChange={(event) => setTemplateEditor((current) => ({ ...current, description: event.target.value }))} placeholder="どんな場面で使うか" /></label>
              <label>文章の種類<select value={templateEditor.source_type} onChange={(event) => setTemplateEditor((current) => ({ ...current, source_type: event.target.value }))}><option value="email">メール</option><option value="chat">チャット</option><option value="meeting">会議メモ</option><option value="work">業務依頼</option><option value="free">自由入力</option></select></label>
              <label>本文<textarea value={templateEditor.content} onChange={(event) => setTemplateEditor((current) => ({ ...current, content: event.target.value }))} placeholder="AI整理へ渡す文章を入力" /></label>
            </div>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setTemplateEditor((current) => ({ ...current, open: false }))}>キャンセル</button><button className="page-primary" onClick={() => void saveTemplate()} disabled={templateSaving}>{templateSaving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{templateSaving ? '保存中…' : '保存する'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
