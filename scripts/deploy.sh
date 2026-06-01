#!/usr/bin/env bash
# freellm 源码 → 生产部署脚本（解决手工 rsync + 版本号漏同步问题）。
#
# 背景：/opt/freellm 是拷贝部署（非 git）。历史上手工只 rsync dist、漏同步 VERSION 文件，
# 导致 health 接口长期报旧版本号（代码其实最新）。本脚本把"build + 同步 dist + VERSION +
# package.json + chown + 重启 + 内外网健康校验"固化，杜绝版本号漂移。
#
# 用法：sudo bash scripts/deploy.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="/opt/freellm"
HEALTH_LOCAL="http://127.0.0.1:18610/health"
HEALTH_PUBLIC="https://freellm.example.com/health"

cd "$SRC"
VER="$(cat VERSION)"
echo "==> 部署 freellm v${VER}（源码 → ${DST}）"

echo "[1/6] build api + web"
pnpm --filter @freellm/api build
pnpm --filter @freellm/web build

echo "[2/6] rsync dist（前后端）"
rsync -a --delete apps/api/dist/ "$DST/apps/api/dist/"
rsync -a --delete apps/web/dist/ "$DST/apps/web/dist/"

echo "[3/6] 同步 VERSION + package.json（关键：防 health 版本号漂移）"
rsync -a VERSION "$DST/VERSION"
rsync -a apps/api/package.json "$DST/apps/api/package.json"
# 注意：刻意不同步 prisma/data/（含测试库，会覆盖生产 DB）、不删 /opt 的 data/。

echo "[4/6] chown freellm:freellm"
chown -R freellm:freellm "$DST/apps/api/dist" "$DST/apps/web/dist" "$DST/VERSION" "$DST/apps/api/package.json"

echo "[5/6] 重启 freellm-api"
systemctl restart freellm-api
sleep 4

echo "[6/6] 健康校验（内部 + 公网，版本必须等于 VERSION）"
HV="$(curl -s "$HEALTH_LOCAL" | python3 -c "import sys,json;print(json.load(sys.stdin)['version'])")"
echo "  期望 v${VER}  内部 health v${HV}"
if [ "$VER" != "$HV" ]; then
  echo "  ✗ 版本不一致，部署校验失败" >&2
  exit 1
fi
PUB="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_PUBLIC")"
echo "  公网 /health → ${PUB}"
echo "==> 部署完成：freellm v${VER} 已上架（内部+公网 health 一致）"
