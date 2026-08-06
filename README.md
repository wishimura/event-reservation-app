# event-reservation-app

カフェイベントの事前予約アプリ。お客様向けの予約フローと、店舗向けの管理画面で構成されています。

- **Next.js 16** (App Router) / React 19 / Tailwind CSS v4
- **Neon** (サーバーレス Postgres) + **Drizzle ORM**

## セットアップ

### 1. Neon プロジェクトを作る

1. https://console.neon.tech でプロジェクトを作成する
2. リージョンは日本から一番近いものを選ぶ（コンソールの選択肢に従う）
3. **Connect** から接続文字列をコピーする
   - ホスト名に `-pooler` が入った **プール接続** を使うこと
   - `?sslmode=require` は付けたままにする

### 2. 環境変数

```bash
cp .env.example .env.local
```

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon のプール接続文字列 |
| `ADMIN_PASSWORD` | `/admin` のログインパスワード |
| `ADMIN_SESSION_SECRET` | セッション Cookie の署名鍵（`openssl rand -base64 32`） |

### 3. スキーマとサンプルデータ

```bash
npm install
npm run db:migrate   # drizzle/ のマイグレーションを適用
npm run db:seed      # サンプルのイベント・商品・日程・在庫を投入
```

`db:seed` は **既存データを全削除してから** 投入します。本番では実行しないこと。

### 4. 起動

```bash
npm run dev          # http://localhost:3927
```

管理画面は `/admin`（初回は `/admin/login` にリダイレクトされます）。

## データベース操作

| コマンド | 内容 |
| --- | --- |
| `npm run db:generate` | `src/db/schema.ts` の変更から新しいマイグレーションSQLを生成 |
| `npm run db:migrate` | 未適用のマイグレーションを適用 |
| `npm run db:push` | スキーマを直接反映（マイグレーションを作らない。開発用） |
| `npm run db:studio` | Drizzle Studio でデータを閲覧・編集 |

スキーマを変えたら `db:generate` → `db:migrate` の順で流し、生成された `drizzle/*.sql` もコミットします。

## 構成メモ

### データアクセスはすべてサーバー側

ブラウザから DB を直接触ることはありません。Server Component は `src/db` 経由で直接クエリし、Client Component は `/api/*` を叩きます。管理系のエンドポイントは `src/middleware.ts` がセッション Cookie を検証します。

### 在庫の競合制御

同時予約でも受付上限を超えないよう、`POST /api/orders` は 1 トランザクション内で条件付き UPDATE を使います。

```sql
UPDATE daily_product_inventory
   SET reserved_quantity = reserved_quantity + $qty
 WHERE id = $id
   AND reserved_quantity + $qty <= production_quantity
```

更新行数が 0 なら在庫不足として注文全体をロールバックします。加えて
`daily_product_inventory_reserved_within_capacity` CHECK 制約が、アプリ側に不具合があっても
`reserved_quantity > production_quantity` を DB レベルで拒否します。

### 日付の扱い

「本日」は常に日本時間で判定します（`todayInJST()`）。サーバーの TZ に依存しません。
