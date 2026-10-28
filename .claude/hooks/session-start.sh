#!/bin/bash
# クラウドのセッションを始めたときに、テストを流せる状態にする。
#
# - 依存パッケージを入れる（前回から package.json が変わっていなければ飛ばす）
# - このコンテナの中に PostgreSQL を立て、開発用と E2E 用のデータベースを作る
# - .env.local が無ければこのコンテナの DB 向けに作る（あれば中身には触らない）
# - このコンテナを指している接続先にだけマイグレーションを当てる
# - 開発用が空なら種データを入れる
# - E2E で使う Chromium の場所を環境変数に入れる
#
# **本番（Neon）には絶対に繋ぎません。** .env.local が Neon を指していたら、その接続先
# には何もしません。E2E はテーブルを空にするので、間違えると予約が消えます。
#
# 何度実行しても同じ結果になるように書いてある。手元の PC では何もしない。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

LOCAL_DEV="postgresql://postgres:postgres@localhost:5432/event_reservation_dev?sslmode=disable"
LOCAL_E2E="postgresql://postgres:postgres@localhost:5432/event_reservation_e2e?sslmode=disable"

# --- 依存パッケージ -------------------------------------------------------------
# このフックは再開・/clear・要約のたびに走る。毎回 npm install を待たせないよう、
# 入れるものを決めるファイルが変わったときだけ走らせる。
# 置き場所は node_modules の中。パッケージごと消えれば次回また入れ直す。
NPM_HASHES=node_modules/.session-start.sha256
if ! sha256sum --check --status "$NPM_HASHES" 2>/dev/null; then
  rm -f "$NPM_HASHES"
  echo "[session-start] npm install"
  npm install --no-audit --no-fund --loglevel=error >/dev/null
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json \
    > "$NPM_HASHES" 2>/dev/null || rm -f "$NPM_HASHES"
fi

# --- PostgreSQL ---------------------------------------------------------------
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[session-start] PostgreSQL をインストール"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null
fi

PG_VERSION="$(ls /etc/postgresql | sort -V | tail -1)"
if ! pg_ctlcluster "$PG_VERSION" main status >/dev/null 2>&1; then
  echo "[session-start] PostgreSQL $PG_VERSION を起動"
  # 起動が途中で止まることがあるので、落ちたらもう一度だけ試す
  pg_ctlcluster "$PG_VERSION" main start || pg_ctlcluster "$PG_VERSION" main start
fi
for _ in $(seq 1 30); do
  pg_isready -q -h localhost && break
  sleep 1
done
pg_isready -q -h localhost

# このコンテナの外からは繋がらないので、固定のパスワードで構わない
su postgres -c "psql -q -c \"ALTER USER postgres PASSWORD 'postgres';\""

# --- .env.local ----------------------------------------------------------------
if [ ! -f .env.local ]; then
  echo "[session-start] .env.local を作成（このコンテナの DB 向け）"
  cat > .env.local <<ENV
DATABASE_URL=$LOCAL_DEV
E2E_DATABASE_URL=$LOCAL_E2E
ADMIN_PASSWORD=qa-password
ADMIN_SESSION_SECRET=$(openssl rand -base64 32)
ENV
fi

read_env() {
  node -e "
    try { process.loadEnvFile('.env.local') } catch {}
    process.stdout.write(process.env['$1'] ?? '')
  "
}

# このコンテナを指している接続先ならデータベース名を、そうでなければ空を返す。
local_db_name() {
  node -e "
    try {
      const u = new URL(process.argv[1]);
      const here = ['localhost', '127.0.0.1'].includes(u.hostname);
      process.stdout.write(here ? u.pathname.slice(1) : '');
    } catch { process.stdout.write(''); }
  " "$1"
}

# --- データベースとマイグレーション ------------------------------------------------
# マイグレーションの中身が前回と同じで、データベースも揃っているなら飛ばす。
DB_HASHES=node_modules/.session-start-db.sha256
NEED_MIGRATE=1
if sha256sum --check --status "$DB_HASHES" 2>/dev/null; then
  NEED_MIGRATE=0
fi

for KEY in DATABASE_URL E2E_DATABASE_URL; do
  URL="$(read_env "$KEY")"
  [ -n "$URL" ] || continue
  DB_NAME="$(local_db_name "$URL")"
  if [ -z "$DB_NAME" ]; then
    echo "[session-start] $KEY はこのコンテナの DB ではないので触らない"
    continue
  fi
  if ! su postgres -c "psql -tAc \"select 1 from pg_database where datname = '$DB_NAME'\"" | grep -q 1; then
    echo "[session-start] データベース $DB_NAME を作成"
    su postgres -c "createdb '$DB_NAME'"
    NEED_MIGRATE=1
  fi
  if [ "$NEED_MIGRATE" = "1" ]; then
    echo "[session-start] $DB_NAME にマイグレーションを当てる"
    DATABASE_URL="$URL" npx drizzle-kit migrate >/dev/null
  fi
done

if [ "$NEED_MIGRATE" = "1" ]; then
  rm -f "$DB_HASHES"
  sha256sum drizzle/meta/_journal.json drizzle/*.sql > "$DB_HASHES" 2>/dev/null || true
fi

# --- 種データ -------------------------------------------------------------------
# 空のときだけ入れる。すでに触っているデータベースを勝手に作り直さない。
DEV_NAME="$(local_db_name "$(read_env DATABASE_URL)")"
if [ -n "$DEV_NAME" ]; then
  COUNT="$(su postgres -c "psql -tAc 'select count(*) from events' '$DEV_NAME'" 2>/dev/null || echo 0)"
  if [ "$COUNT" = "0" ]; then
    echo "[session-start] 種データを入れる"
    npm run db:seed >/dev/null
  fi
fi

# --- E2E のブラウザ ---------------------------------------------------------------
# /opt/pw-browsers/chromium は版を指すシンボリックリンク。版が上がっても追従する。
if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] 準備完了"
