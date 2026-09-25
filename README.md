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
| `RESEND_API_KEY` | 予約確認メールの送信に使う Resend の API キー |
| `MAIL_FROM` | 送信元アドレス（Resend で DNS 認証済みのドメイン） |
| `SHOP_NOTIFICATION_EMAIL` | 新規予約の通知先。空なら店舗宛の通知は送りません |
| `SQUARE_ACCESS_TOKEN` | Square のアクセストークン。**お金を動かせる鍵** |
| `SQUARE_APPLICATION_ID` | Square アプリケーション ID（公開値） |
| `SQUARE_LOCATION_ID` | 入金先の店舗 ID（公開値） |
| `SQUARE_ENVIRONMENT` | `production` で本番。それ以外はサンドボックス |

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

### 管理画面の構成

| 画面 | 用途 |
| --- | --- |
| ダッシュボード | 本日の受取状況、売上、在庫アラート |
| 在庫管理 | 受取日ごとの受付上限・売切・非表示の設定 |
| 製造計画 | 予約数の日別／商品別の集計 |
| 注文一覧 | 検索・CSV出力・**注文のキャンセル** |
| 受取管理 | 当日の受渡しチェック |
| 商品マスタ | 商品の追加・編集・削除 |
| イベント設定 | イベント基本情報と受取日の管理 |

受取日または商品を追加すると、`daily_product_inventory` の行が自動で作られます。この行が無いと商品はその日に表示されないため、片方だけ増やして噛み合わなくなることはありません。

注文のキャンセルは**片道**です。押さえていた在庫は受付枠に戻り、締め切っていた受取日は自動的に再開します。取り消せる状態にすると在庫の二重計上を招くため、やり直しは再予約で対応してください。

### 予約確認メール

予約が確定すると、お客様宛の確認メールと店舗宛の新規予約通知を Resend で送ります。

送信は `next/server` の `after()` でレスポンス返却後に回しており、**送信の失敗が予約の成立に影響することはありません**。失敗はログに残るだけです。`RESEND_API_KEY` か `MAIL_FROM` が未設定の環境では送信自体をスキップするので、ローカル開発でメール設定は必須ではありません。

送信元ドメインは Resend 側で DNS 認証（TXT レコードの追加）を済ませておく必要があります。未認証のドメインを `MAIL_FROM` に設定すると、送信が拒否されます。

### 決済（Square）

`SQUARE_ACCESS_TOKEN` / `SQUARE_APPLICATION_ID` / `SQUARE_LOCATION_ID` の**3つが揃ったときだけ**カード決済に切り替わります。1つでも欠けていれば現地払いのまま動くので、認証情報が未設定の環境で予約が止まることはありません。

予約の流れは「在庫確保 → 3Dセキュア認証 → カード決済 → 確定」です。

1. トランザクション内で在庫を押さえ、注文を `temporary` / `pending` で作成
2. Square で決済（冪等キーは注文 ID なので、再送されても二重課金になりません）
3. 成功したら `confirmed` / `paid` に更新し、`square_payment_id` を保存
4. 失敗したら `cancelOrderAndReleaseStock()` で在庫を戻し、402 を返す

#### 3Dセキュア（本人認証）

カード番号をトークン化したあと、ブラウザ側で `payments.verifyBuyer()` を呼びます。カード会社が本人認証を求める場合はここで認証画面が出るため、**この処理はサーバーではなくブラウザで完結させる必要があります**。得られた `verificationToken` を `/api/orders` 経由で決済に渡します。

カード会社が認証不要と判断した場合、`verifyBuyer()` は何も返しません。これは正常な結果なので、トークン無しでそのまま決済します。逆に、認証が必要なのにトークンを付けずに決済すると Square 側で拒否されます。

認証額は注文金額そのままです。円には補助単位が無いため、金額は `"1500"` のように**小数点なし**で渡します（`"1500.00"` ではありません）。

**返金は自動化していません。** キャンセルは電話で受け、返金は Square の管理画面から手動で行う運用です。そのため注文には `square_payment_id` と `square_receipt_url` を保存し、管理画面のキャンセル操作時に「Square から返金してください」と決済 ID を表示します。

### 日付の扱い

「本日」は常に日本時間で判定します（`todayInJST()`）。サーバーの TZ に依存しません。
