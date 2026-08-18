PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'email',
  content TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  display_name TEXT NOT NULL DEFAULT '山田 花子',
  workspace_name TEXT NOT NULL DEFAULT 'ワークスペースA',
  default_tone TEXT NOT NULL DEFAULT '丁寧',
  default_source_type TEXT NOT NULL DEFAULT 'email',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_templates_favorite ON templates(is_favorite DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

INSERT OR IGNORE INTO app_settings (id) VALUES (1);

INSERT OR IGNORE INTO templates (id, title, description, source_type, content, is_favorite)
VALUES
  (
    'template-meeting-followup',
    '会議後の対応整理',
    '会議メモから担当・期限・確認事項を整理します。',
    'meeting',
    '本日の会議内容を共有します。決定事項は以下の通りです。\n・資料を修正する\n・見積条件を確認する\n・次回会議までに進捗を共有する\n担当者と期限を含めて整理してください。',
    1
  ),
  (
    'template-email-request',
    '依頼メールのタスク化',
    '複数の依頼が含まれるメールを実行単位に分解します。',
    'email',
    'お疲れさまです。以下の件について対応をお願いします。\n1. 月次資料の更新\n2. 関係者への確認\n3. 金曜日までの進捗共有\nよろしくお願いします。',
    1
  ),
  (
    'template-invoice-check',
    '請求・見積の確認',
    '請求書や見積書の確認項目を抜けなく整理します。',
    'email',
    '添付の見積書について、金額・納期・支払条件・承認者を確認し、不明点を先方へ問い合わせてください。確認後、経理担当へ共有をお願いします。',
    0
  );
