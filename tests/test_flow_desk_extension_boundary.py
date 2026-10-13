"""Keep Flow Desk on DeerFlow's public extension contract."""

from __future__ import annotations

import ast
import re
import tomllib
from pathlib import Path

import pytest


_ROOT = Path(__file__).resolve().parents[1]
_EXTENSION_ROOT = (
    _ROOT / "product" / "backend-extension" / "flow_desk_product_extension"
)
_EXTENSION_PROJECT = _ROOT / "product" / "backend-extension" / "pyproject.toml"
_CONTRACT_PROJECT = _ROOT / "backend" / "packages" / "extension-api" / "pyproject.toml"
_CONTRACT_MODULE = (
    _ROOT
    / "backend"
    / "packages"
    / "extension-api"
    / "deerflow_extension_api"
    / "__init__.py"
)
_PRIVATE_MODULE_ROOTS = ("app", "deerflow")


def _is_private_module(module: str) -> bool:
    """Match private package roots without rejecting deerflow-extension-api."""
    return any(
        module == root or module.startswith(f"{root}.")
        for root in _PRIVATE_MODULE_ROOTS
    )


def _private_imports(source: Path) -> list[str]:
    return _private_imports_in_source(
        source.read_text(encoding="utf-8"), filename=str(source)
    )


def _private_imports_in_source(
    source: str, *, filename: str = "<extension-source>"
) -> list[str]:
    tree = ast.parse(source, filename=filename)
    importlib_names = {"importlib"}
    import_module_names = {"import_module"}
    violations: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "importlib":
                    importlib_names.add(alias.asname or "importlib")
                if _is_private_module(alias.name):
                    violations.append(f"line {node.lineno}: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module == "importlib":
                for alias in node.names:
                    if alias.name == "import_module":
                        import_module_names.add(alias.asname or alias.name)
            if _is_private_module(module):
                violations.append(f"line {node.lineno}: from {module} import …")
        elif isinstance(node, ast.Call):
            importer: str | None = None
            if isinstance(node.func, ast.Name):
                if node.func.id == "__import__" or node.func.id in import_module_names:
                    importer = node.func.id
            elif (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "import_module"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id in importlib_names
            ):
                importer = f"{node.func.value.id}.import_module"

            if importer and node.args and isinstance(node.args[0], ast.Constant):
                target = node.args[0].value
                if isinstance(target, str) and _is_private_module(target):
                    violations.append(f"line {node.lineno}: {importer}({target!r})")

    return violations


_EXTENSION_SOURCES = sorted(_EXTENSION_ROOT.rglob("*.py"))


@pytest.mark.parametrize(
    "source",
    _EXTENSION_SOURCES,
    ids=lambda source: source.relative_to(_ROOT).as_posix(),
)
def test_product_extension_uses_only_public_deerflow_contracts(source: Path) -> None:
    # DeerFlow 内部模块没有稳定扩展保证；直接依赖会让上游升级牵动产品代码。
    violations = _private_imports(source)

    assert not violations, f"{source.relative_to(_ROOT)}: {', '.join(violations)}"


@pytest.mark.parametrize(
    ("source", "expected_count"),
    [
        ("from app.gateway import deps\n", 1),
        ("import deerflow.runtime\n", 1),
        ("__import__('app.gateway.auth')\n", 1),
        ("importlib.import_module('deerflow.runtime')\n", 1),
        ("from deerflow_extension_api import resolve_principal\n", 0),
    ],
)
def test_private_import_detector_rejects_host_modules_only(
    source: str, expected_count: int
) -> None:
    # 用内存源码验证扫描规则，避免创建临时文件或依赖宿主包是否已安装。
    assert len(_private_imports_in_source(source)) == expected_count


def test_flow_desk_extension_requirement_and_marker_match_public_api_version() -> None:
    """产品扩展的安装门槛和加载标记必须随公开 API 一起升级。"""
    contract_version = tomllib.loads(_CONTRACT_PROJECT.read_text(encoding="utf-8"))[
        "project"
    ]["version"]
    contract_module = ast.parse(_CONTRACT_MODULE.read_text(encoding="utf-8"))
    runtime_versions = [
        node.value.value
        for node in ast.walk(contract_module)
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == "API_VERSION"
            for target in node.targets
        )
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    ]
    assert runtime_versions == [contract_version]

    extension_project = tomllib.loads(_EXTENSION_PROJECT.read_text(encoding="utf-8"))[
        "project"
    ]
    requirements = [
        dependency
        for dependency in extension_project["dependencies"]
        if dependency.startswith("deerflow-extension-api")
    ]
    assert len(requirements) == 1
    assert f">={contract_version}" in requirements[0]
    assert re.search(r"(?:^|,)\s*<\s*\d", requirements[0])

    extension_entry = ast.parse(
        (_EXTENSION_ROOT / "__init__.py").read_text(encoding="utf-8")
    )
    declared_versions = [
        keyword.value.value
        for node in ast.walk(extension_entry)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        for decorator in node.decorator_list
        if isinstance(decorator, ast.Call)
        and isinstance(decorator.func, ast.Name)
        and decorator.func.id == "extension"
        for keyword in decorator.keywords
        if keyword.arg == "api"
        and isinstance(keyword.value, ast.Constant)
        and isinstance(keyword.value.value, str)
    ]
    assert declared_versions == [contract_version]
