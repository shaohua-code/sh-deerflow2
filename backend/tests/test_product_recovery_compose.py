"""Keep the recovery Compose overlay isolated from a live application stack."""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def test_recovery_overlay_namespaces_every_fixed_container():
    """A Compose project name cannot override explicit upstream container names."""
    base = _load_yaml(REPO_ROOT / "docker" / "docker-compose.yaml")
    postgres = _load_yaml(REPO_ROOT / "product" / "deploy" / "docker-compose.postgres.yaml")
    recovery = _load_yaml(REPO_ROOT / "product" / "deploy" / "docker-compose.isolated-recovery.yaml")
    recovery_services = recovery["services"]

    fixed_names = {name for name, service in base["services"].items() if service.get("container_name")}
    fixed_names.update(name for name, service in postgres["services"].items() if service.get("container_name"))
    expected_services = fixed_names | {"postgres"}

    assert expected_services <= recovery_services.keys()
    for service_name in expected_services:
        name = recovery_services[service_name].get("container_name", "")
        assert name.startswith("${RECOVERY_STACK_NAME:?Set RECOVERY_STACK_NAME in the isolated recovery .env}-"), f"{service_name} must require a unique recovery container prefix"


def test_recovery_overlay_keeps_project_scoped_volumes_and_loopback_port():
    """The recovery project must inherit Compose volumes and the private nginx port."""
    recovery = _load_yaml(REPO_ROOT / "product" / "deploy" / "docker-compose.isolated-recovery.yaml")

    assert "volumes" not in recovery
    assert "networks" not in recovery
    assert "ports" not in recovery["services"]["nginx"]
