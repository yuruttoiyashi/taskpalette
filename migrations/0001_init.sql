PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'free',
  tone TEXT NOT NULL DEFAULT '丁寧',
  reply_draft TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'fallback',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  analysis_id TEXT,
  title TEXT NOT NULL,
  assignee TEXT NOT NULL DEFAULT '未設定',
  deadline TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
  confirmation TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '業務',
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'doing', 'waiting', 'done')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_logs(created_at DESC);
