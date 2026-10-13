#!/usr/bin/env python3
"""Compare committed Git trees without checking out files or changing remotes."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple


class TreeEntry(NamedTuple):
    mode: str
    object_type: str
    object_id: str


class TreeComparison(NamedTuple):
    identical: tuple[bytes, ...]
    changed: tuple[bytes, ...]
    local_only: tuple[bytes, ...]
    upstream_only: tuple[bytes, ...]


class TreeSnapshot(NamedTuple):
    repository: Path
    ref: str
    commit: str
    tree: str
    object_format: str
    entries: dict[bytes, TreeEntry]


def parse_ls_tree(output: bytes) -> dict[bytes, TreeEntry]:
    """Parse ``git ls-tree -rz`` records while preserving raw path bytes."""
    entries: dict[bytes, TreeEntry] = {}
    for record in output.split(b"\0"):
        if not record:
            continue
        header, separator, path = record.partition(b"\t")
        fields = header.split(b" ")
        if not separator or len(fields) != 3 or not all(fields):
            raise ValueError(f"malformed git ls-tree record: {record!r}")
        try:
            mode, object_type, object_id = (field.decode("ascii") for field in fields)
        except UnicodeDecodeError as exc:
            raise ValueError(f"non-ASCII git ls-tree metadata: {record!r}") from exc
        if path in entries:
            raise ValueError(f"duplicate path in git ls-tree output: {path!r}")
        entries[path] = TreeEntry(mode, object_type, object_id)
    return entries


def compare_trees(
    local: dict[bytes, TreeEntry], upstream: dict[bytes, TreeEntry]
) -> TreeComparison:
    """Classify paths using mode, object type, and object ID."""
    identical: list[bytes] = []
    changed: list[bytes] = []
    local_only: list[bytes] = []
    upstream_only: list[bytes] = []

    for path in sorted(local.keys() | upstream.keys()):
        local_entry = local.get(path)
        upstream_entry = upstream.get(path)
        if local_entry is None:
            upstream_only.append(path)
        elif upstream_entry is None:
            local_only.append(path)
        elif local_entry == upstream_entry:
            identical.append(path)
        else:
            changed.append(path)

    return TreeComparison(
        tuple(identical), tuple(changed), tuple(local_only), tuple(upstream_only)
    )


def object_format_from_oid(object_id: str) -> str:
    """Infer the Git object hash format from a full hexadecimal object ID."""
    if len(object_id) not in (40, 64) or any(
        character not in "0123456789abcdefABCDEF" for character in object_id
    ):
        raise ValueError(f"unexpected Git object ID: {object_id!r}")
    return "sha1" if len(object_id) == 40 else "sha256"


def _git(repository: Path, *arguments: str) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-C", str(repository), *arguments],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise RuntimeError(f"could not run Git for {repository}: {exc}") from exc
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or f"Git exited with status {result.returncode}")
    return result.stdout


def read_tree(repository: Path, ref: str) -> TreeSnapshot:
    """Resolve a commit and read its tree without checking it out."""
    repository = repository.expanduser().resolve()
    if not ref or ref.startswith("-"):
        raise ValueError("Git ref must be non-empty and must not start with '-'")

    commit = (
        _git(
            repository,
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{ref}^{{commit}}",
        )
        .strip()
        .decode("ascii")
    )
    tree = (
        _git(
            repository,
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{commit}^{{tree}}",
        )
        .strip()
        .decode("ascii")
    )
    # Git 2.21 on Windows accepts unknown rev-parse tokens as revision names,
    # so infer the format from the resolved full object ID instead.
    object_format = object_format_from_oid(commit)
    entries = parse_ls_tree(
        _git(repository, "ls-tree", "-r", "-z", "--full-tree", tree)
    )
    return TreeSnapshot(repository, ref, commit, tree, object_format, entries)


def _display_path(path: bytes) -> str:
    decoded = path.decode("utf-8", errors="backslashreplace")
    escaped = (
        decoded.replace("\\", "\\\\")
        .replace("`", "\\`")
        .replace("|", "\\|")
        .replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("\t", "\\t")
    )
    return f"`{escaped}`"


def _top_level(path: bytes) -> bytes:
    return path.split(b"/", maxsplit=1)[0] if b"/" in path else b"(root)"


def _format_paths(title: str, paths: tuple[bytes, ...]) -> list[str]:
    lines = [f"## {title} ({len(paths)})", ""]
    if paths:
        lines.extend(f"- {_display_path(path)}" for path in paths)
    else:
        lines.append("- 无")
    lines.append("")
    return lines


def format_report(local: TreeSnapshot, upstream: TreeSnapshot) -> str:
    """Render a reviewable Markdown report for the two committed trees."""
    if local.object_format != upstream.object_format:
        raise ValueError(
            "Git object formats differ; compare content with an object-format-aware "
            "tool instead of treating object IDs as equivalent: "
            f"{local.object_format} != {upstream.object_format}"
        )
    comparison = compare_trees(local.entries, upstream.entries)
    categories = (
        ("共有且完全相同", comparison.identical),
        ("共有但内容或模式不同", comparison.changed),
        ("仅本地存在", comparison.local_only),
        ("仅上游存在", comparison.upstream_only),
    )
    lines = [
        "# Git Tree 源码差异报告",
        "",
        "本报告只比较两个已提交 Git tree 的路径、文件模式、对象类型和对象 ID；",
        "不会检出文件、访问网络、修改 Git remote 或改写工作区。",
        "",
        "| 来源 | 仓库 | 输入 ref | commit | root tree | object format |",
        "| --- | --- | --- | --- | --- | --- |",
        f"| 本地 | `{local.repository}` | `{local.ref}` | `{local.commit}` | `{local.tree}` | `{local.object_format}` |",
        f"| 上游 | `{upstream.repository}` | `{upstream.ref}` | `{upstream.commit}` | `{upstream.tree}` | `{upstream.object_format}` |",
        "",
        "## 路径统计",
        "",
        "| 类别 | 数量 |",
        "| --- | ---: |",
    ]
    lines.extend(f"| {name} | {len(paths)} |" for name, paths in categories)

    changed_by_root: dict[bytes, int] = {}
    for path in (
        *comparison.changed,
        *comparison.local_only,
        *comparison.upstream_only,
    ):
        root = _top_level(path)
        changed_by_root[root] = changed_by_root.get(root, 0) + 1
    lines.extend(
        ["", "## 差异路径一级目录分布", "", "| 目录 | 路径数 |", "| --- | ---: |"]
    )
    if changed_by_root:
        lines.extend(
            f"| {_display_path(root)} | {count} |"
            for root, count in sorted(changed_by_root.items())
        )
    else:
        lines.append("| 无 | 0 |")

    lines.append("")
    lines.extend(_format_paths("共有但内容或模式不同", comparison.changed))
    lines.extend(_format_paths("仅本地存在", comparison.local_only))
    lines.extend(_format_paths("仅上游存在", comparison.upstream_only))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Read and compare two committed Git trees without checking out files, "
            "changing remotes, or modifying either repository."
        )
    )
    parser.add_argument("--local-repo", type=Path, default=Path("."))
    parser.add_argument("--local-ref", required=True)
    parser.add_argument("--upstream-repo", type=Path, required=True)
    parser.add_argument("--upstream-ref", required=True)
    args = parser.parse_args(argv)

    try:
        local = read_tree(args.local_repo, args.local_ref)
        upstream = read_tree(args.upstream_repo, args.upstream_ref)
        report = format_report(local, upstream)
    except (RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(report, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
