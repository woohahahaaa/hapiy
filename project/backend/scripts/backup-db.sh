#!/usr/bin/env bash
# 数据库备份脚本：只备份 backend/hapiy.db（项目唯一的真实库），写入仓库根 .backup/。
# 以后让 Agent 备份数据库时统一跑这个脚本，不要自由发挥 cp。
# 用法：
#   scripts/backup-db.sh          # 备份（先做 sqlite 完整性校验）
#   scripts/backup-db.sh --list   # 列出已有备份
# 自动保留最近 15 份 hapiy-*.db，更早的删除。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/../.." && pwd)"
SOURCE="$BACKEND_DIR/hapiy.db"
DEST_DIR="$REPO_ROOT/.backup"
RETENTION=15

if [ "${1:-}" = "--list" ]; then
  ls -lht "$DEST_DIR"/hapiy-*.db 2>/dev/null || echo "暂无备份"
  exit 0
fi

if [ ! -f "$SOURCE" ]; then
  echo "[backup-db] 源库不存在: $SOURCE" >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  if ! sqlite3 "$SOURCE" "PRAGMA integrity_check;" 2>/dev/null | grep -q '^ok$'; then
    echo "[backup-db] 完整性校验未通过，中止备份" >&2
    exit 1
  fi
fi

mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/hapiy-$(date +%Y%m%d-%H%M%S).db"
cp -p "$SOURCE" "$DEST"
echo "[backup-db] 已备份: $DEST"

for f in $(ls -1t "$DEST_DIR"/hapiy-*.db 2>/dev/null | tail -n +$((RETENTION + 1))); do
  rm -f "$f"
  echo "[backup-db] 清理旧备份: $f"
done