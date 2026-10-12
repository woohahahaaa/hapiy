#!/usr/bin/env sh
# project.sh — hapiy 的 woohkit 接入。契约见 alive/woohkit/CONTRACT.md。
#
# 这里只有「本项目是什么栈、怎么构建、怎么打包」；守护、停栈、端口、发布流水线
# 都在 kit 里。alive/ 下的入口（alive.sh / release.sh）与 woohkit/ 快照由 kit
# 同步，勿手改。

# ===========================================================================
# 一、项目信息
# ===========================================================================

# 身份与默认端口在项目根目录 woohkit.json（name / id / defaultPort）。

STATE_DIR="${HAPIY_STATE_DIR:-$HOME/.hapiy}"
APP_DIR="${HAPIY_HOME:-$STATE_DIR}/app"
BIN="$APP_DIR/hapiy"

WEB_DIR="$ROOT_DIR/project/web"
BACKEND_DIR="$ROOT_DIR/project/backend"
DEV_BIN="$BACKEND_DIR/hapiy"
DEV_API_PORT=8080

# 交叉编译到 darwin（release）需要 cgo。
GO_CGO_ENV="CGO_ENABLED=1"

# ===========================================================================
# 二、alive
# ===========================================================================

build_backend_to() {
  (cd "$BACKEND_DIR" && go build -o "$1" ./cmd/hapiy)
}

# seed_state_db — 首次运行时把仓库里的数据库（和加密密钥）拷进状态目录，这样
# 切到「已安装」布局不会把现存的供应商/令牌配置丢下。
seed_state_db() {
  if [ ! -f "$STATE_DIR/hapiy.db" ] && [ -f "$BACKEND_DIR/hapiy.db" ]; then
    msg "seeding state db from repo -> $STATE_DIR/hapiy.db"
    mkdir -p "$STATE_DIR"
    cp "$BACKEND_DIR/hapiy.db" "$STATE_DIR/hapiy.db"
    if [ -f "$BACKEND_DIR/encryption.key" ]; then
      cp "$BACKEND_DIR/encryption.key" "$STATE_DIR/encryption.key"
    fi
  fi
}

proj_build() {
  msg "building frontend (production bundle)…"
  (cd "$WEB_DIR" && pnpm build)

  mkdir -p "$APP_DIR"
  msg "building backend -> $BIN"
  build_backend_to "$BIN.new"
  mv -f "$BIN.new" "$BIN"
  chmod +x "$BIN"

  msg "syncing webdist -> $APP_DIR/webdist"
  rsync -a --delete "$WEB_DIR/dist/" "$APP_DIR/webdist/"
  seed_state_db
}

proj_dev_build() {
  msg "building backend (dev) -> $DEV_BIN"
  build_backend_to "$DEV_BIN"
}

proj_run() {
  HAPIY_ENV=production HAPIY_HOST=0.0.0.0 HAPIY_PORT="$PORT" \
    HAPIY_STATE_DIR="$STATE_DIR" HAPIY_DB_PATH="$STATE_DIR/hapiy.db" \
    HAPIY_LOG_DIR="$STATE_DIR/logs" HAPIY_WEB_DIST="$APP_DIR/webdist" \
    "$BIN" serve
}

proj_health() {
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)
  [ -n "$code" ] && [ "$code" != "000" ]
}

proj_dev_run() {
  # dev 后端（:8080）挂成边车；前端 Vite 是前台公共端口（:$PORT）。
  kit_sidecar api "HAPIY_ENV=development HAPIY_HOST=0.0.0.0 HAPIY_PORT=$DEV_API_PORT HAPIY_STATE_DIR='$STATE_DIR' HAPIY_DB_PATH='$STATE_DIR/hapiy.db' HAPIY_LOG_DIR='$STATE_DIR/logs' exec '$DEV_BIN' serve"
  cd "$WEB_DIR" || return 1
  ./node_modules/.bin/vite --port "$PORT" --strictPort
}

proj_dev_health() {
  proj_health && curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$DEV_API_PORT/" 2>/dev/null | grep -qv '^000$'
}

# 上一代 alive.sh 走的是二进制自带守护（up/down）：先让它自己优雅收掉，免得
# 端口清理之后它再重生。迁移稳定后可删这段。
proj_stop_first() {
  if [ -x "$BIN" ]; then
    HAPIY_STATE_DIR="$STATE_DIR" HAPIY_DB_PATH="$STATE_DIR/hapiy.db" "$BIN" down >/dev/null 2>&1 || true
  fi
  if [ -x "$DEV_BIN" ]; then
    HAPIY_STATE_DIR="$STATE_DIR" HAPIY_DB_PATH="$STATE_DIR/hapiy.db" "$DEV_BIN" down >/dev/null 2>&1 || true
  fi
}

proj_service_pause() {
  [ -x "$BIN" ] && "$BIN" service stop --quiet 2>/dev/null || true
}

proj_pre_start() {
  [ "$MODE" = prod ] || return 0
  msg "firewall allow-list…"
  firewall_mode_arg=""
  [ "${HAPIY_FIREWALL:-global}" = "per-binary" ] || firewall_mode_arg="--global"
  "$BACKEND_DIR/scripts/firewall-allow.sh" $firewall_mode_arg "$BIN" || \
    die "firewall allow-list setup failed; aborting so we don't start a server nobody can reach."
}

# ===========================================================================
# 三、release
# ===========================================================================

RELEASE_REPO="woohahahaaa/hapiy"
RELEASE_PLATFORMS="darwin-universal windows-amd64 linux-amd64 linux-arm64"

INSTALL_EXTRA_DIR="webdist"
INSTALL_DESKTOP=0
INSTALL_EXPORT_PORT_ENV=1
INSTALL_HEALTH_PATH="/"

proj_version() {
  grep -o 'Version = "[^"]*"' "$ROOT_DIR/project/backend/internal/version/version.go" | head -1 | sed 's/Version = "//;s/"//'
}

proj_build_web() {
  msg "building frontend ($VERSION) …"
  (cd "$WEB_DIR" && pnpm build)
}

proj_stage() {
  platform="$1"
  dir="$2"
  case "$platform" in
    darwin-universal)
      kit_go_universal "$BACKEND_DIR" "$dir/hapiy" ./cmd/hapiy
      ;;
    windows-amd64)
      kit_go_build "$BACKEND_DIR" windows amd64 "$dir/hapiy.exe" ./cmd/hapiy
      ;;
    linux-amd64)
      kit_go_build "$BACKEND_DIR" linux amd64 "$dir/hapiy" ./cmd/hapiy
      ;;
    linux-arm64)
      kit_go_build "$BACKEND_DIR" linux arm64 "$dir/hapiy" ./cmd/hapiy
      ;;
  esac
  cp -R "$WEB_DIR/dist" "$dir/webdist"
}

proj_asset() {
  case "$1" in
    darwin-universal) printf '%s\n' "hapiy-darwin-universal.tar.gz" ;;
    windows-amd64)    printf '%s\n' "hapiy-windows-amd64.zip" ;;
    linux-amd64)      printf '%s\n' "hapiy-linux-amd64.tar.gz" ;;
    linux-arm64)      printf '%s\n' "hapiy-linux-arm64.tar.gz" ;;
  esac
}
