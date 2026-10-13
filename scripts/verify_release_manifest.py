#!/usr/bin/env python3
"""校验 Flow Desk 发布记录的必填字段和可验证格式。

该工具只做静态格式检查，不连接 GitHub、服务器、容器仓库或数据库，
也不证明清单中填写的测试、镜像和备份事实真实有效。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SHA1_RE = re.compile(r"^[0-9a-fA-F]{40}$")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
STABLE_RELEASE_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
CHECKS = (
    "build",
    "backend_tests",
    "frontend_check",
    "smoke_test",
    "upgrade_compatibility",
    "backup_restore",
)
REQUIRED_PASSED_CHECKS = set(CHECKS)
OFFICIAL_REPOSITORY = "https://github.com/bytedance/deer-flow"


def _is_nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _require_object(value: Any, path: str, errors: list[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        errors.append(f"{path}: 必须是 JSON 对象")
        return {}
    return value


def _require_string(
    value: Any,
    path: str,
    errors: list[str],
    *,
    pattern: re.Pattern[str] | None = None,
    pattern_hint: str = "",
) -> None:
    if not _is_nonempty_string(value):
        errors.append(f"{path}: 必须填写非空字符串")
    elif pattern is not None and pattern.fullmatch(value.strip()) is None:
        errors.append(
            f"{path}: 格式无效{f'（{pattern_hint}）' if pattern_hint else ''}"
        )


def _require_utc_timestamp(value: Any, path: str, errors: list[str]) -> None:
    if not _is_nonempty_string(value) or not value.endswith("Z"):
        errors.append(f"{path}: 必须填写 UTC 时间，格式如 2026-10-04T12:30:00Z")
        return
    try:
        datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        errors.append(f"{path}: 不是有效的 ISO 8601 UTC 时间")


def validate_manifest(data: Any) -> list[str]:
    """返回清单校验问题；空列表表示格式完整。"""
    errors: list[str] = []
    root = _require_object(data, "$", errors)
    if not root:
        return errors

    schema_version = root.get("schema_version")
    if (
        not isinstance(schema_version, int)
        or isinstance(schema_version, bool)
        or schema_version != 1
    ):
        errors.append("schema_version: 当前只支持整数 1")
    _require_string(root.get("release_id"), "release_id", errors)
    _require_utc_timestamp(root.get("created_at"), "created_at", errors)
    _require_string(root.get("owner"), "owner", errors)

    product = _require_object(root.get("product"), "product", errors)
    _require_string(
        product.get("version"),
        "product.version",
        errors,
        pattern=SEMVER_RE,
        pattern_hint="语义化版本号，例如 1.2.3",
    )
    _require_string(
        product.get("commit"),
        "product.commit",
        errors,
        pattern=SHA1_RE,
        pattern_hint="40 位 Git commit SHA",
    )

    upstream = _require_object(root.get("upstream"), "upstream", errors)
    repository = upstream.get("repository")
    _require_string(repository, "upstream.repository", errors)
    if _is_nonempty_string(repository):
        parsed = urlparse(repository.strip())
        if (
            parsed.scheme != "https"
            or parsed.netloc != "github.com"
            or parsed.path.rstrip("/") != "/bytedance/deer-flow"
            or parsed.query
            or parsed.fragment
        ):
            errors.append(f"upstream.repository: 必须是官方仓库 {OFFICIAL_REPOSITORY}")
    _require_string(
        upstream.get("tag"),
        "upstream.tag",
        errors,
        pattern=STABLE_RELEASE_TAG_RE,
        pattern_hint="官方稳定版 tag，例如 v2.1.0",
    )
    _require_string(
        upstream.get("commit"),
        "upstream.commit",
        errors,
        pattern=SHA1_RE,
        pattern_hint="40 位 Git commit SHA",
    )
    _require_utc_timestamp(upstream.get("verified_at"), "upstream.verified_at", errors)

    images = root.get("images")
    if not isinstance(images, list) or not images:
        errors.append("images: 至少记录一个实际部署的容器镜像")
    else:
        seen_services: set[str] = set()
        for index, item in enumerate(images):
            path = f"images[{index}]"
            image = _require_object(item, path, errors)
            _require_string(image.get("service"), f"{path}.service", errors)
            _require_string(image.get("reference"), f"{path}.reference", errors)
            _require_string(
                image.get("digest"),
                f"{path}.digest",
                errors,
                pattern=re.compile(r"^sha256:[0-9a-fA-F]{64}$"),
                pattern_hint="sha256: 加 64 位十六进制摘要",
            )
            digest = image.get("digest")
            reference = image.get("reference")
            if (
                _is_nonempty_string(digest)
                and _is_nonempty_string(reference)
                and not reference.endswith(f"@{digest}")
            ):
                errors.append(
                    f"{path}.reference: 必须使用与 digest 一致的不可变 image@sha256 引用"
                )
            service = image.get("service")
            if _is_nonempty_string(service):
                if service in seen_services:
                    errors.append(f"{path}.service: 重复记录服务 {service}")
                seen_services.add(service)

    configuration = _require_object(root.get("configuration"), "configuration", errors)
    config_version = configuration.get("schema_version")
    if (
        not isinstance(config_version, int)
        or isinstance(config_version, bool)
        or config_version < 1
    ):
        errors.append("configuration.schema_version: 必须是正整数")
    for key in ("config_example_sha256", "extensions_example_sha256"):
        _require_string(
            configuration.get(key),
            f"configuration.{key}",
            errors,
            pattern=SHA256_RE,
            pattern_hint="64 位十六进制 SHA-256",
        )

    migrations = _require_object(root.get("migrations"), "migrations", errors)
    for key in ("gateway", "product_extension"):
        values = migrations.get(key)
        if not isinstance(values, list) or not values:
            errors.append(
                f'migrations.{key}: 必须列出迁移 revision；无迁移时明确填写 ["none"]'
            )
        elif any(not _is_nonempty_string(value) for value in values):
            errors.append(f"migrations.{key}: revision 必须是非空字符串")

    backup = _require_object(root.get("backup"), "backup", errors)
    _require_string(backup.get("id"), "backup.id", errors)
    if backup.get("restore_verified") is not True:
        errors.append("backup.restore_verified: 必须为 true，且应有真实隔离恢复证据")
    _require_string(backup.get("evidence"), "backup.evidence", errors)

    verification = _require_object(root.get("verification"), "verification", errors)
    for check_name in CHECKS:
        path = f"verification.{check_name}"
        check = _require_object(verification.get(check_name), path, errors)
        status = check.get("status")
        valid_statuses = {"passed", "failed", "pending"}
        if not isinstance(status, str) or status not in valid_statuses:
            errors.append(f"{path}.status: 必须是 passed、failed 或 pending")
        elif check_name in REQUIRED_PASSED_CHECKS and status != "passed":
            errors.append(f"{path}.status: 首期发布要求全部六项检查均为 passed")
        elif status == "passed":
            _require_string(check.get("evidence"), f"{path}.evidence", errors)
        else:
            errors.append(f"{path}.status: 发布清单不能包含未通过或待执行的检查")

    issues = root.get("unresolved_issues")
    if not isinstance(issues, list) or any(
        not _is_nonempty_string(issue) for issue in issues
    ):
        errors.append("unresolved_issues: 必须是字符串数组；没有未解决问题时填写 []")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="静态检查 Flow Desk 发布清单；不会连接外部服务或证明清单内容真实。"
    )
    parser.add_argument("manifest", type=Path, help="发布 JSON 清单路径")
    args = parser.parse_args(argv)

    try:
        with args.manifest.open("r", encoding="utf-8") as source:
            data = json.load(source)
    except OSError as exc:
        print(f"无法读取发布清单 {args.manifest}: {exc}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(
            f"发布清单不是有效 JSON（第 {exc.lineno} 行，第 {exc.colno} 列）",
            file=sys.stderr,
        )
        return 2

    errors = validate_manifest(data)
    if errors:
        print(f"发布清单未通过：发现 {len(errors)} 个问题。", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"发布清单格式完整：{args.manifest}")
    print("注意：此检查不核实 commit、镜像、测试结果或备份证据是否真实。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
