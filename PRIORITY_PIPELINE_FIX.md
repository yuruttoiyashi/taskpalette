# Priority pipeline fix

This revision fixes priority handling at the extraction pipeline level.

- Explicit priority sentences such as `優先度は高とする。` are parsed independently of the AI response.
- The priority marker is attached to the nearest preceding actionable sentence in the same paragraph.
- If Workers AI omits that important task, the Worker restores the task from the source text instead of losing the priority instruction.
- AI normalization no longer cuts the result at 12 tasks before priority reconciliation (up to 24 AI tasks are normalized, with up to 30 final tasks).
- Fallback parsing no longer keeps only the first 8 actionable sentences and no longer discards normal tasks just because a generic known task was found.
- The AI result page no longer hides tasks after the first 12 rows.
- Draft results now show whether the run used `Workers AI + ルール補正` or `簡易解析 + ルール補正` for easier diagnosis.

No D1 migration is required.
