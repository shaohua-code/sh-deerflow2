"""安全地同步三个发布版本源；升级流程可重复执行。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


_SEMVER = re.compile(
    r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)


def _replace_one(
    source: str,
    pattern: str,
    version: str,
    label: str,
    *,
    expected_old: str | None = None,
) -> str:
    """字段缺失或重复时直接拒绝，避免误改同名依赖或局部写入。"""
    matches = list(re.finditer(pattern, source, flags=re.MULTILINE))
    if len(matches) != 1:
        raise ValueError(
            f"{label}: expected exactly one version field, found {len(matches)}"
        )
    match = matches[0]
    if expected_old is not None and match.group("value") != expected_old:
        raise ValueError(f"{label}: matched a different version than the root field")
    replacement = f"{match.group('prefix')}{version}{match.group('suffix')}"
    return source[: match.start()] + replacement + source[match.end() :]


def plan_version_bump(root: Path, version: str) -> dict[Path, tuple[bytes, bytes]]:
    """完整读取和检查所有版本源后返回写入计划，不碰磁盘内容。"""
    if _SEMVER.fullmatch(version) is None:
        raise ValueError(f"invalid SemVer: {version!r}")

    paths = {
        "backend": root / "backend" / "pyproject.toml",
        "frontend": root / "frontend" / "package.json",
        "chart": root / "deploy" / "helm" / "deer-flow" / "Chart.yaml",
    }
    originals = {name: path.read_bytes() for name, path in paths.items()}
    sources = {name: data.decode("utf-8") for name, data in originals.items()}

    # 只允许修改 [project] 段，不能碰其他 TOML 表里的同名 version。
    project = re.search(
        r"(?ms)^\[project\][ \t]*\r?\n(?P<body>.*?)(?=^\[|\Z)",
        sources["backend"],
    )
    if project is None:
        raise ValueError("backend/pyproject.toml: missing [project] section")
    body = project.group("body")
    new_body = _replace_one(
        body,
        r'^(?P<prefix>[ \t]*version[ \t]*=[ \t]*")[^"\r\n]*(?P<suffix>"[ \t]*(?:\#[^\r\n]*)?\r?)$',
        version,
        "backend/pyproject.toml [project]",
    )
    backend = (
        sources["backend"][: project.start("body")]
        + new_body
        + sources["backend"][project.end("body") :]
    )

    # 先解析 JSON，确认要改的是根对象的 version；只接受仓库现有的两空格排版。
    package = json.loads(sources["frontend"])
    if not isinstance(package, dict) or not isinstance(package.get("version"), str):
        raise ValueError("frontend/package.json: missing root version string")
    frontend = _replace_one(
        sources["frontend"],
        r'^(?P<prefix>  "version"[ \t]*:[ \t]*")(?P<value>[^"\r\n]*)(?P<suffix>"[ \t]*,?[ \t]*\r?)$',
        version,
        "frontend/package.json root",
        expected_old=package["version"],
    )

    chart = _replace_one(
        sources["chart"],
        r"^(?P<prefix>version:[ \t]*)\S[^\r\n#]*?(?P<suffix>[ \t]*(?:\#[^\r\n]*)?\r?)$",
        version,
        "Chart.yaml version",
    )
    chart = _replace_one(
        chart,
        r'^(?P<prefix>appVersion:[ \t]*")[^"\r\n]*(?P<suffix>"[ \t]*(?:\#[^\r\n]*)?\r?)$',
        version,
        "Chart.yaml appVersion",
    )

    updated = {"backend": backend, "frontend": frontend, "chart": chart}
    return {
        paths[name]: (originals[name], updated[name].encode("utf-8")) for name in paths
    }


def bump_version(root: Path, version: str) -> list[Path]:
    """全部预检成功后才开始写；已是目标版本时无需改动。"""
    plan = plan_version_bump(root, version)
    changed: list[Path] = []
    try:
        for path, (before, after) in plan.items():
            if before != after:
                # 先加入回退清单：当前文件写到一半失败时也要恢复原始字节。
                changed.append(path)
                path.write_bytes(after)
    except OSError as exc:
        rollback_errors = []
        for path in reversed(changed):
            try:
                path.write_bytes(plan[path][0])
            except OSError as rollback_exc:
                rollback_errors.append(f"{path}: {rollback_exc}")
        if rollback_errors:
            raise OSError(
                f"version write failed: {exc}; rollback also failed: {'; '.join(rollback_errors)}"
            ) from exc
        raise
    return changed


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("Usage: version_bump.py <version>", file=sys.stderr)
        return 1
    root = Path(__file__).resolve().parents[1]
    try:
        changed = bump_version(root, args[0])
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: version bump aborted: {exc}", file=sys.stderr)
        return 1
    print(f"Version {args[0]}: updated {len(changed)} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
