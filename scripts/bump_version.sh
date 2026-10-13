#!/usr/bin/env bash
# 同步产品版本：先由 Python 对全部版本源做预检，再写入文件。
# 用法：scripts/bump_version.sh <version>（可带 v 前缀）。
# 本脚本只修改仓库内的版本文件，不创建 tag，也不推送代码。

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <version>   (e.g. $0 2.2.0)" >&2
  exit 1
fi

VERSION="${1#v}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_SCRIPT="$ROOT/scripts/version_bump.py"

# Git Bash 常调用原生 Windows Python；传入 Windows 路径，避免 Python 把 /d/... 当作根目录。
if command -v cygpath >/dev/null 2>&1; then
  VERSION_SCRIPT="$(cygpath -w "$VERSION_SCRIPT")"
fi

if [ -n "${PYTHON:-}" ]; then
  PYTHON_BIN="$PYTHON"
elif command -v cygpath >/dev/null 2>&1 && [ -x "$ROOT/backend/.venv/Scripts/python.exe" ]; then
  # 已安装项目依赖的 Windows 开发环境优先使用项目 Python，绕开 WindowsApps 的空别名。
  PYTHON_BIN="$ROOT/backend/.venv/Scripts/python.exe"
else
  PYTHON_BIN=python3
fi

"$PYTHON_BIN" "$VERSION_SCRIPT" "$VERSION"
bash "$ROOT/scripts/verify_versions.sh" "$VERSION"

echo "Next steps: review the changed files and update CHANGELOG.md before a release."
