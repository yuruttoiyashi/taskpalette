PRAGMA foreign_keys = ON;

-- 初期デザイン確認用に登録されていた架空の担当者付きデモデータを削除します。
DELETE FROM tasks WHERE analysis_id = 'demo-analysis';
DELETE FROM activity_logs WHERE analysis_id = 'demo-analysis';
DELETE FROM analyses WHERE id = 'demo-analysis';

-- 過去のAI解析結果も原文と照合し、原文に存在しない担当者名は未設定へ戻します。
-- 手動追加タスク（analysis_id IS NULL）は変更しません。
UPDATE tasks
SET assignee = '未設定',
    updated_at = CURRENT_TIMESTAMP
WHERE analysis_id IS NOT NULL
  AND assignee NOT IN ('', '未設定', '未定', '不明', 'なし', '無し')
  AND NOT EXISTS (
    SELECT 1
    FROM analyses
    WHERE analyses.id = tasks.analysis_id
      AND instr(
        replace(replace(analyses.source_text, ' ', ''), '　', ''),
        replace(replace(tasks.assignee, ' ', ''), '　', '')
      ) > 0
  );
