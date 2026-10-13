"""发布版本同步的失败关闭契约。"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "version_bump.py"
_SPEC = importlib.util.spec_from_file_location("version_bump", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
version_bump = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(version_bump)


def _version_files(root: Path, *, newline: str = "\n") -> tuple[Path, Path, Path]:
    backend = root / "backend" / "pyproject.toml"
    frontend = root / "frontend" / "package.json"
    chart = root / "deploy" / "helm" / "deer-flow" / "Chart.yaml"
    for path in (backend, frontend, chart):
        path.parent.mkdir(parents=True, exist_ok=True)
    backend.write_bytes(
        (
            '[project]\nname = "deer-flow"\nversion = "2.1.0"\n'
            '[tool.other]\nversion = "unchanged"\n'
        )
        .replace("\n", newline)
        .encode("utf-8")
    )
    frontend.write_bytes(
        (
            '{\n  "name": "frontend",\n  "version": "2.1.0",\n'
            '  "nested": {"version": "unchanged"}\n}\n'
        )
        .replace("\n", newline)
        .encode("utf-8")
    )
    chart.write_bytes(
        ('apiVersion: v2\nversion: 2.1.0\nappVersion: "2.1.0"\n')
        .replace("\n", newline)
        .encode("utf-8")
    )
    return backend, frontend, chart


def test_bump_updates_only_top_level_versions_and_is_repeatable(tmp_path: Path) -> None:
    backend, frontend, chart = _version_files(tmp_path, newline="\r\n")

    assert version_bump.bump_version(tmp_path, "2.2.0") == [backend, frontend, chart]
    assert version_bump.bump_version(tmp_path, "2.2.0") == []
    assert b"\r\n" in backend.read_bytes()
    assert b"\n" not in backend.read_bytes().replace(b"\r\n", b"")
    assert 'version = "2.2.0"' in backend.read_text(encoding="utf-8")
    assert '[tool.other]\nversion = "unchanged"' in backend.read_text(encoding="utf-8")
    assert (
        json.loads(frontend.read_text(encoding="utf-8"))["nested"]["version"]
        == "unchanged"
    )
    assert 'appVersion: "2.2.0"' in chart.read_text(encoding="utf-8")


def test_missing_late_field_does_not_partially_update_earlier_files(
    tmp_path: Path,
) -> None:
    files = _version_files(tmp_path)
    files[2].write_text("apiVersion: v2\nversion: 2.1.0\n", encoding="utf-8")
    before = [path.read_bytes() for path in files]

    with pytest.raises(ValueError, match="Chart.yaml appVersion"):
        version_bump.bump_version(tmp_path, "2.2.0")

    assert [path.read_bytes() for path in files] == before


def test_duplicate_late_field_does_not_partially_update_earlier_files(
    tmp_path: Path,
) -> None:
    files = _version_files(tmp_path)
    files[2].write_text(
        'apiVersion: v2\nversion: 2.1.0\nversion: 2.1.0\nappVersion: "2.1.0"\n',
        encoding="utf-8",
    )
    before = [path.read_bytes() for path in files]

    with pytest.raises(ValueError, match="Chart.yaml version: expected exactly one"):
        version_bump.bump_version(tmp_path, "2.2.0")

    assert [path.read_bytes() for path in files] == before


def test_invalid_version_does_not_change_sources(tmp_path: Path) -> None:
    files = _version_files(tmp_path)
    before = [path.read_bytes() for path in files]

    with pytest.raises(ValueError, match="invalid SemVer"):
        version_bump.bump_version(tmp_path, "2.2.0junk")

    assert [path.read_bytes() for path in files] == before


def test_write_failure_restores_all_original_bytes(tmp_path: Path, monkeypatch) -> None:
    files = _version_files(tmp_path)
    before = {path: path.read_bytes() for path in files}
    original_write = Path.write_bytes
    failed = False

    def write_once_then_fail(path: Path, data: bytes) -> int:
        nonlocal failed
        if path == files[1] and data != before[path] and not failed:
            failed = True
            raise OSError("simulated second-file write failure")
        return original_write(path, data)

    monkeypatch.setattr(Path, "write_bytes", write_once_then_fail)

    with pytest.raises(OSError, match="simulated second-file write failure"):
        version_bump.bump_version(tmp_path, "2.2.0")

    assert {path: path.read_bytes() for path in files} == before


def test_real_version_sources_accept_a_read_only_preflight() -> None:
    root = Path(__file__).resolve().parents[1]
    package = json.loads(
        (root / "frontend" / "package.json").read_text(encoding="utf-8")
    )

    plan = version_bump.plan_version_bump(root, package["version"])

    assert len(plan) == 3
    assert all(before == after for before, after in plan.values())
