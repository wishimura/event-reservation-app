# テスト

何をどこで確かめるかの方針と、E2E が何を保証しているかは
`docs/シナリオテスト仕様書.md` にあります。本書は動かし方です。

| 層 | ファイル | 何を見るか | 準備 |
| --- | --- | --- | --- |
| 単体 | `unit.test.ts` | 締切・売切・消費税・名寄せ・注文番号・接続先の判定 | 不要 |
| 結合 | `api.test.ts` / `admin.test.ts` | API とデータベースの往復 | 使い捨てDB＋起動中のサーバー |
| 結合（踏み込み） | `deep.test.ts` | 原子性・同時実行・画面とAPIの食い違い | 同上 |
| 結合（決済） | `payment.test.ts` | 決済が失敗した側に倒れたときの後始末 | 同上＋Square の認証情報を入れたサーバー |
| E2E | `e2e/*.e2e.ts` | 実ブラウザでの導線（PC幅・スマホ幅） | 専用DB（`E2E_DATABASE_URL`） |

**E2E のファイル名は `*.e2e.ts` です。名前に `spec` も `test` も入れないでください。**
入れると `npm test`（node:test）の収集に拾われて落ちます。逆に `.spec.ts` で作ると
Playwright の `testMatch` から外れて**黙って実行されない**ので、
`npm run check:scenarios` が見つけて落とします。

## まとめて

```bash
npm run check      # lint → 型 → 単体 → 仕様書とE2Eの対応
npm run test:e2e   # ブラウザを通した確認（数分）
```

## 単体

```bash
npm test
```

DBもサーバーも要りません。

## E2E

```bash
npm run test:e2e                      # PC幅とスマホ幅の両方
npx playwright test -g "S-05"         # 名寄せのシナリオだけ
npx playwright test --project=desktop # PC幅だけ
```

`playwright.config.ts` が `npm run build` から本番サーバーまで面倒を見ます。
すでにサーバーを立てているなら `E2E_BASE_URL` を渡せば使い回します。

**専用のデータベースが要ります。** 各テストの前に全テーブルを空にするので、
`E2E_DATABASE_URL` は `DATABASE_URL` と別の、名前に `e2e` / `test` / `_ci` を
含むものにしてください。満たさないと安全ガード（`e2e/_helpers/db.ts`）が止めます。

ブラウザの場所が違う環境では `E2E_CHROMIUM_PATH` で指定します
（このコンテナなら `/opt/pw-browsers/chromium`）。

落ちたときは `test-results/` にスクリーンショットと trace が残ります。

```bash
npx playwright show-trace test-results/<失敗したテスト>/trace.zip
```

## 結合

**使い捨てのデータベースに向けたサーバーに対してのみ実行してください。**
予約を作り、在庫を動かし、注文を消します。本番には絶対に向けないこと。

```bash
npm run db:seed                    # 受取日は今日から数えて作られる
npx next start --port 3981 &
BASE_URL=http://127.0.0.1:3981 ADMIN_PASSWORD=<開発用> npm run test:integration
```

テストは互いの結果に依存しないよう「今日以降の受取日」だけを使い、作った受取日や
商品は後片付けします。それでも失敗が続くときは `npm run db:seed` で入れ直して
ください。

## 決済まわり

`payment.test.ts` だけは、Square の認証情報が入った状態のサーバーに向けて実行します。
値は本物でなくて構いません（むしろ本物でないほうが、確実に決済が失敗してくれて
「失敗したときの後始末」を確かめやすくなります）。

```bash
SQUARE_ACCESS_TOKEN=qa-fake \
SQUARE_APPLICATION_ID=sandbox-sq0idb-qafake \
SQUARE_LOCATION_ID=QAFAKELOC \
  npx next start --port 3982 &

BASE_URL=http://localhost:3982 npm run test:payment
```

**カード決済が通ること自体は、どのテストでも確かめていません。** 本番で人が
1件通してください（`docs/シナリオテスト仕様書.md` の「保証していないこと」）。

## ローカルのデータベース

本番は Neon、手元はこのコンテナの PostgreSQL です。**どちらのドライバを使うかは
`src/db/index.ts` が接続先の URL から選びます**。ファイルを書き換える必要はありません
（以前は手で差し替えていて、戻し忘れると本番が繋がらなくなる作業でした）。

クラウドのセッションでは `.claude/hooks/session-start.sh` が、PostgreSQL の起動から
2つのデータベースの作成、マイグレーション、種データまで用意します。手でやるなら:

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
su postgres -c "createdb event_reservation_dev; createdb event_reservation_e2e"

cat > .env.local <<'ENV'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/event_reservation_dev?sslmode=disable
E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/event_reservation_e2e?sslmode=disable
ADMIN_PASSWORD=qa-password
ADMIN_SESSION_SECRET=<openssl rand -base64 32>
ENV

npx drizzle-kit migrate
DATABASE_URL="$E2E_DATABASE_URL" npx drizzle-kit migrate
npm run db:seed
```
