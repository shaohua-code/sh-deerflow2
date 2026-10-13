"""Flow Desk 发布清单静态校验器的契约测试。"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_release_manifest.py"
_SPEC = importlib.util.spec_from_file_location("verify_release_manifest", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
verify_release_manifest = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(verify_release_manifest)


def _valid_manifest() -> dict:
    return {
        "schema_version": 1,
        "release_id": "flowdesk-1.2.3-20261004",
        "created_at": "2026-10-04T12:30:00Z",
        "owner": "release-operator",
        "product": {"version": "1.2.3", "commit": "a" * 40},
        "upstream": {
            "repository": "https://github.com/bytedance/deer-flow",
            "tag": "v2.1.0",
            "commit": "b" * 40,
            "verified_at": "2026-10-04T12:00:00Z",
        },
        "images": [
            {
                "service": "gateway",
                "reference": "registry.example/flowdesk-gateway@sha256:" + "c" * 64,
                "digest": "sha256:" + "c" * 64,
            }
        ],
        "configuration": {
            "schema_version": 45,
            "config_example_sha256": "d" * 64,
            "extensions_example_sha256": "e" * 64,
        },
        "migrations": {"gateway": ["none"], "product_extension": ["none"]},
        "backup": {
            "id": "backup-20261004-120000",
            "restore_verified": True,
            "evidence": "evidence/restore-report.md",
        },
        "verification": {
            name: {"status": "passed", "evidence": f"evidence/{name}.md"}
            for name in verify_release_manifest.CHECKS
        },
        "unresolved_issues": [],
    }


def test_complete_release_manifest_passes_static_contract() -> None:
    assert verify_release_manifest.validate_manifest(_valid_manifest()) == []


def test_cli_accepts_a_complete_manifest(tmp_path) -> None:
    path = tmp_path / "release.json"
    path.write_text(json.dumps(_valid_manifest()), encoding="utf-8")

    assert verify_release_manifest.main([str(path)]) == 0


def test_incomplete_template_fails_with_actionable_fields() -> None:
    template_path = (
        Path(__file__).resolve().parents[1]
        / "product/deploy/release-manifest.example.json"
    )
    template = json.loads(template_path.read_text(encoding="utf-8"))

    errors = verify_release_manifest.validate_manifest(template)

    assert any("product.commit" in error for error in errors)
    assert any("backup.restore_verified" in error for error in errors)
    assert any("verification.upgrade_compatibility.status" in error for error in errors)


def test_release_gate_rejects_fake_upstream_and_bad_image_digest() -> None:
    manifest = _valid_manifest()
    manifest["upstream"]["repository"] = "https://github.com/someone/deer-flow"
    manifest["images"][0]["digest"] = "latest"

    errors = verify_release_manifest.validate_manifest(manifest)

    assert any("upstream.repository" in error for error in errors)
    assert any("images[0].digest" in error for error in errors)


def test_release_gate_requires_stable_tag_and_integer_schema_version() -> None:
    manifest = _valid_manifest()
    manifest["upstream"]["tag"] = "v2.1.0-rc.1"
    manifest["schema_version"] = 1.0

    errors = verify_release_manifest.validate_manifest(manifest)

    assert any("upstream.tag" in error for error in errors)
    assert any("schema_version" in error for error in errors)


def test_release_gate_rejects_mismatched_image_reference_and_digest() -> None:
    manifest = _valid_manifest()
    manifest["images"][0]["reference"] = "registry.example/flowdesk-gateway:latest"

    errors = verify_release_manifest.validate_manifest(manifest)

    assert any("images[0].reference" in error for error in errors)


def test_release_gate_rejects_failed_restore_and_missing_migration_decision() -> None:
    manifest = _valid_manifest()
    manifest["backup"]["restore_verified"] = False
    manifest["verification"]["backup_restore"] = {
        "status": "failed",
        "evidence": "evidence/restore-report.md",
    }
    manifest["migrations"]["gateway"] = []

    errors = verify_release_manifest.validate_manifest(manifest)

    assert any("backup.restore_verified" in error for error in errors)
    assert any("verification.backup_restore.status" in error for error in errors)
    assert any("migrations.gateway" in error for error in errors)


def test_release_gate_reports_invalid_status_type_without_crashing() -> None:
    manifest = _valid_manifest()
    manifest["verification"]["build"]["status"] = []

    errors = verify_release_manifest.validate_manifest(manifest)

    assert any("verification.build.status" in error for error in errors)


def test_launch_gate_requires_all_six_release_checks_to_pass() -> None:
    manifest = _valid_manifest()
    manifest["verification"]["frontend_check"]["status"] = "not_applicable"

    errors = verify_release_manifest.validate_manifest(manifest)

    assert any("verification.frontend_check.status" in error for error in errors)
