PRAGMA foreign_keys = ON;

ALTER TABLE tasks ADD COLUMN execution_order INTEGER;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, rowid ASC) AS rn
  FROM tasks
)
UPDATE tasks
SET execution_order = (SELECT rn FROM ranked WHERE ranked.id = tasks.id);

CREATE INDEX IF NOT EXISTS idx_tasks_execution_order ON tasks(execution_order);
