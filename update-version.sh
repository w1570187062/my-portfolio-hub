#!/usr/bin/env bash
# update-version.sh — 更新根目录 VERSION 文件（git 最近提交的 短哈希|ISO8601 时间戳）
#
# 用法：./update-version.sh          # 部署前跑一次即可
#       ./update-version.sh --quiet # 静默模式，仅写文件不打印
#
# VERSION 会被 Dockerfile 在 build 阶段读取，经 -ldflags -X 注入
# portfolio/internal/api.BuildInfo，最终显示在 web 页脚。
# 不在 git 仓库或尚无提交时回退写入 "dev"。

set -euo pipefail
cd "$(dirname "$0")"

QUIET=0
if [ "${1:-}" = "--quiet" ]; then
  QUIET=1
fi

INFO="$(git log -1 --format='%h|%cI' 2>/dev/null || true)"
if [ -z "$INFO" ]; then
  INFO="dev"
  if [ "$QUIET" -ne 1 ]; then
    echo "⚠️  不在 git 仓库或尚无提交，VERSION 写入 dev"
  fi
fi

printf '%s' "$INFO" > VERSION

if [ "$QUIET" -ne 1 ]; then
  echo "✔  VERSION = $INFO"
  echo "已写入 $(pwd)/VERSION"
fi
