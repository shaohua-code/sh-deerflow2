"""根目录初始化脚本必须为新 checkout 生成完整的本地配置集合。"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "configure.py"
_SPEC = importlib.util.spec_from_file_location("deerflow_configure", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
configure = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(configure)


def _write_templates(root: Path) -> None:
    (root / "scripts").mkdir(parents=True)
    (root / "frontend").mkdir()
    for relative, value in {
        "config.example.yaml": "models: []\n",
        "extensions_config.example.json": '{"mcpServers": {}, "skills": {}}\n',
        ".env.example": "APP_SECRET=example\n",
        "frontend/.env.example": "NEXT_PUBLIC_BACKEND_BASE_URL=\n",
    }.items():
        (root / relative).write_text(value, encoding="utf-8")


def test_configure_creates_all_local_config_files_from_templates(
    tmp_path, monkeypatch
) -> None:
    _write_templates(tmp_path)
    monkeypatch.setattr(
        configure, "__file__", str(tmp_path / "scripts" / "configure.py")
    )

    assert configure.main() == 0

    assert (tmp_path / "config.yaml").read_text(encoding="utf-8") == "models: []\n"
    assert (tmp_path / "extensions_config.json").read_text(encoding="utf-8") == (
        '{"mcpServers": {}, "skills": {}}\n'
    )
    assert (tmp_path / ".env").read_text(encoding="utf-8") == "APP_SECRET=example\n"
    assert (tmp_path / "frontend/.env").read_text(encoding="utf-8") == (
        "NEXT_PUBLIC_BACKEND_BASE_URL=\n"
    )


def test_configure_keeps_existing_main_config_untouched(tmp_path, monkeypatch) -> None:
    _write_templates(tmp_path)
    (tmp_path / "config.yaml").write_text("models: [existing]\n", encoding="utf-8")
    monkeypatch.setattr(
        configure, "__file__", str(tmp_path / "scripts" / "configure.py")
    )

    assert configure.main() == 1
    assert (tmp_path / "config.yaml").read_text(
        encoding="utf-8"
    ) == "models: [existing]\n"
