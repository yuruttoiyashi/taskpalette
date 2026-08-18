# 担当者の架空名を削除する修正

## 修正内容

- 初期デモデータの「山田 花子」「鈴木 一郎」「田中 美咲」を削除
- AIの担当者出力を入力原文と照合
- 既存のAIタスクも原文にない担当者名を「未設定」へ修正
- 入力に明記されていない担当者はサーバー側で必ず「未設定」に変換

## ローカルD1へ反映

```powershell
npm run db:migrate:local
npm run cf:dev
```

## 本番D1へ反映

```powershell
npm run db:migrate:remote
npm run deploy
```

`0003_remove_demo_data.sql` はデモ分析IDだけを対象にするため、ユーザーが作成したタスクは削除しません。
