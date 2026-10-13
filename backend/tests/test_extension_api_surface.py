"""The contract package's public surface must import cleanly and stay complete.

A typo in a re-exported name breaks `import deerflow_extension_api` for every
extension, which is a silent-until-startup failure for third parties.
"""

import importlib


def test_public_surface_imports_and_matches_all():
    module = importlib.import_module("deerflow_extension_api")
    for name in module.__all__:
        assert hasattr(module, name), f"__all__ advertises {name!r} but it is not exported"


def test_runtime_deps_is_exported_under_its_documented_name():
    from deerflow_extension_api import ExtensionRuntimeDeps

    assert ExtensionRuntimeDeps.__name__ == "ExtensionRuntimeDeps"


def test_admin_action_observation_contract_is_public_and_serializable():
    from datetime import UTC, datetime

    from deerflow_extension_api import AdminActionEvent, AdminActionObserver

    event = AdminActionEvent(
        actor_user_id="admin-1",
        action="account.status.disable",
        resource_type="account",
        resource_id="user-2",
        outcome="success",
        occurred_at=datetime(2026, 9, 28, tzinfo=UTC),
        request_id="request-1",
    )

    assert event.resource_id == "user-2"
    assert event.action == "account.status.disable"
    assert hasattr(AdminActionObserver, "on_admin_action")


def test_api_version_matches_the_packaging_metadata():
    """A contract version that disagrees with the wheel's version makes pip
    resolution and the ``@extension`` marker disagree about the same host."""
    import tomllib
    from pathlib import Path

    from deerflow_extension_api import API_VERSION

    pyproject = Path(__file__).resolve().parents[1] / "packages" / "extension-api" / "pyproject.toml"
    declared = tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"]["version"]
    assert declared == API_VERSION


def test_every_contract_kind_added_for_the_0_2_series_is_exported():
    import deerflow_extension_api as api

    for name in (
        "AdminActionEvent",
        "AdminActionObserver",
        "AgentAssemblyDescriptor",
        "AgentAssemblyObserver",
        "CompactionEvent",
        "ContentKind",
        "ContextCompactionObserver",
        "ExtensionPrincipal",
        "MessageProvenance",
        "MiddlewareDescriptor",
        "OwnerDataReader",
        "OwnerDataDeleter",
        "OwnerAgentPage",
        "OwnerFile",
        "OwnerFileEntry",
        "OwnerFilePage",
        "OwnerFiles",
        "OwnerMessagePage",
        "OwnerProjectPage",
        "OwnerScheduledTaskPage",
        "OwnerThreadPage",
        "PROVENANCE_KEYS",
        "ReleasePolicyProvider",
        "ToolDescriptor",
        "canonical_hash",
        "collect_release_policies",
        "provenance_kwargs",
        "read_provenance",
        "require_admin",
        "require_permission",
        "resolve_principal",
    ):
        assert name in api.__all__, f"{name} must be part of the public contract"


def test_owner_data_deleter_keeps_agent_deletion_an_optional_public_method():
    from deerflow_extension_api import OwnerDataDeleter

    assert callable(getattr(OwnerDataDeleter, "delete_agent", None))
    assert callable(getattr(OwnerDataDeleter, "delete_file", None))
    assert hasattr(OwnerDataDeleter, "supports_file_delete")


def test_registry_protocol_declares_every_registration_method():
    from deerflow_extension_api import ExtensionRegistry

    for method in (
        "middlewares",
        "task_lifecycle",
        "system_model_observer",
        "agent_assembly_observer",
        "context_compaction_observer",
        "admin_action_observer",
        "service",
        "routers",
    ):
        assert hasattr(ExtensionRegistry, method), f"ExtensionRegistry must declare {method}()"
