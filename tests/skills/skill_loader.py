"""Load a skill's scripts/generate.py as an importable module, by file path.

Skills live in skills/public/<name>/scripts/generate.py and are NOT a package,
so tests load them via importlib. Tests then mock the module's `requests`.
"""
import importlib.util
import sys
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parents[2]


def load(skill_name: str):
    """Return the generate.py module for skills/public/<skill_name>."""
    path = REPO_ROOT / "skills" / "public" / skill_name / "scripts" / "generate.py"
    mod_name = skill_name.replace("-", "_") + "_generate"
    spec = importlib.util.spec_from_file_location(mod_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module  # standard pattern; lets the module resolve itself
    # 就地加载时禁止写入 __pycache__：字节码缓存会污染规范技能树，
    # 让后端 SkillScan 审查把 .pyc 判为不可解码代码文件而报 error。
    previous_dont_write_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_dont_write_bytecode
    return module


class FakeResp:
    """Minimal stand-in for requests.Response."""

    def __init__(self, json_data=None, content=b"", status_code=200):
        self._json = json_data if json_data is not None else {}
        self.content = content
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        return self._json
