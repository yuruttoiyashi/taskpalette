PRAGMA foreign_keys = ON;

ALTER TABLE tasks ADD COLUMN prerequisite TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tasks_prerequisite ON tasks(prerequisite);
