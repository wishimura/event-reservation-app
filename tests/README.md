# テスト

3層あります。下に行くほど準備が要ります。

| 層 | ファイル | 何を見るか | 準備 |
| --- | --- | --- | --- |
| 単体 | `unit.test.ts` | 締切・売切・受取時間・注文番号などの判断 | 不要 |
| 結合 | `api.test.ts` / `admin.test.ts` | API とデータベースの往復 | 使い捨てDB＋起動中のサーバー |
| シナリオ | `scenario.e2e.ts` | 実ブラウザでの導線 | 上記＋Playwright |

## 単体

```bash
npm test
```

DBもサーバーも要りません。CI に置くならまずこれです。

## 結合

**使い捨てのデータベースに向けたサーバーに対してのみ実行してください。**
予約を作り、在庫を動かし、注文を消します。本番には絶対に向けないこと。

```bash
# 1. 空のデータベースにスキーマと本番同等のデータを入れる
psql "$DATABASE_URL" -f drizzle/0000_init.sql   # 0001〜も順に
psql "$DATABASE_URL" -f docs/production-data-2026-11.sql

# 2. そのDBを指してサーバーを起動
npm run dev

# 3. 別のターミナルで
BASE_URL=http://localhost:3927 ADMIN_PASSWORD=<開発用> npm run test:integration
```

テストは互いの結果に依存しないよう「今日以降の受取日」だけを使い、作った受取日や
商品は後片付けします。それでも失敗が続くときは、データを入れ直してから再実行して
ください。

## シナリオ

Playwright は依存に入れていません。実行するときだけ入れます。

```bash
npm i --no-save playwright
BASE_URL=http://localhost:3927 ADMIN_PASSWORD=<開発用> npx tsx tests/scenario.e2e.ts
```

お客様の予約（PC・スマホ）、店休日が一覧に出ないこと、管理画面の各ページ、
スマホ幅で横スクロールが出ないことを通しで見ます。

Chromium の場所が違う場合は `CHROME_PATH` で指定してください。

## ローカルのデータベースについて

本番は Neon で、アプリは `drizzle-orm/neon-serverless`（WebSocket）を使います。
このドライバは**素の PostgreSQL には繋がりません**。手元の PostgreSQL で動かす
場合は、`src/db/index.ts` のドライバを一時的に `drizzle-orm/node-postgres` +
`pg` に差し替えてください（コミットしないこと）。

Neon のブランチ機能で使い捨てDBを作れば、差し替えは不要です。
