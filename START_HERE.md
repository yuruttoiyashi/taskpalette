# TaskPalette 機能拡張版｜最初にここを読んでください

この版では、サイドバー6画面と上部タスク検索を実装しています。

## 既存プロジェクトへ上書きした場合

`wrangler.jsonc` のD1 IDはそのままで大丈夫です。追加されたマイグレーションだけ適用します。

```powershell
npm run db:migrate:local
npm run cf:dev
```

本番側にも反映するときは、デプロイ前に次を実行します。

```powershell
npm run db:migrate:remote
npm run deploy
```

今回追加される `0002_navigation_features.sql` により、次のテーブルがD1へ追加されます。

- `templates`：AI整理用テンプレート
- `app_settings`：表示名・ワークスペース・AI初期設定

既存のタスク、解析履歴、ログは消えません。

## 新規に始める場合

```powershell
npm install
npx wrangler login
npm run db:create
```

表示された `database_id` を `wrangler.jsonc` に貼り付けた後、次を実行します。

```powershell
npm run db:migrate:local
npm run cf:dev
```

通常は `http://localhost:8787` で開きます。

## 実装された画面

- **ホーム**：サマリー、最新タスク、返信文、AIログ
- **AI整理**：文章入力、AI解析、最新結果、返信文生成
- **タスク一覧**：全文検索、状態・優先度フィルター、並べ替え、編集、削除
- **テンプレート**：D1保存、作成、編集、お気に入り、削除、AI整理への反映
- **履歴**：過去の原文・返信文・抽出件数、操作ログ、再利用
- **設定**：表示名、ワークスペース名、初期トーン、初期文章種類をD1保存

## 上部タスク検索

- タスク名、担当者、カテゴリ、確認事項を横断検索
- 入力中にD1から候補を表示
- Enterでタスク一覧へ移動して絞り込み
- `Ctrl + K` で検索欄へフォーカス

## 注意

`npm run dev` はUIのみです。D1とWorker APIを含めて確認するときは、必ず `npm run cf:dev` を使ってください。
