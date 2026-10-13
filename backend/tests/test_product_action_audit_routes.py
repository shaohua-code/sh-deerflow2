"""Flow Desk operation audit wiring without a live Gateway or database."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from _router_auth_helpers import call_unwrapped
from fastapi import HTTPException

from app.gateway import action_audit
from app.gateway.routers import auth, project_documents, projects, scheduled_tasks, skills, threads, trash, uploads
from app.gateway.routers.threads import ThreadDeleteResponse


def test_action_audit_uses_server_identity_and_trace_and_ignores_missing_extension(monkeypatch):
    recorded = []
    monkeypatch.setattr(action_audit, "get_effective_user_id", lambda: "owner-1")
    monkeypatch.setattr(action_audit, "ensure_trace_id", lambda: "trace-1")

    async def save_event(extensions, event):
        recorded.append((extensions, event))

    monkeypatch.setattr(action_audit, "notify_admin_action", save_event)
    extensions = SimpleNamespace(admin_action_observers=(("flow-desk", object()),))
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(extensions=extensions)))
    asyncio.run(
        action_audit.notify_action_audit(
            request,
            action="thread.delete",
            resource_type="thread",
            resource_id="thread-1",
        )
    )

    assert recorded[0][0] is extensions
    event = recorded[0][1]
    assert (event.actor_user_id, event.action, event.resource_type, event.resource_id) == (
        "owner-1",
        "thread.delete",
        "thread",
        "thread-1",
    )
    assert event.request_id == "trace-1"
    assert event.outcome == "success"

    long_resource_id = "x" * 256
    asyncio.run(
        action_audit.notify_action_audit(
            request,
            action="thread.delete",
            resource_type="thread",
            resource_id=long_resource_id,
        )
    )
    assert recorded[1][1].resource_id.startswith("sha256:")
    assert len(recorded[1][1].resource_id) < 255

    asyncio.run(
        action_audit.notify_action_audit(
            SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace())),
            action="upload.delete",
            resource_type="thread_upload",
            resource_id="thread-1",
        )
    )
    assert len(recorded) == 2


def test_action_audit_can_use_a_verified_account_for_anonymous_creation_request(monkeypatch):
    recorded = []
    monkeypatch.setattr(action_audit, "get_effective_user_id", lambda: None)

    async def save_event(_extensions, event):
        recorded.append(event)

    monkeypatch.setattr(action_audit, "notify_admin_action", save_event)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(extensions=SimpleNamespace(admin_action_observers=(("flow-desk", object()),)))))

    asyncio.run(
        action_audit.notify_action_audit(
            request,
            action="auth.account.register",
            resource_type="account",
            resource_id="new-user-1",
            actor_user_id="new-user-1",
        )
    )

    assert recorded[0].actor_user_id == "new-user-1"


def test_pat_create_audits_id_but_never_token_name_scope_or_secret(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    monkeypatch.setattr(
        auth,
        "get_current_user_from_request",
        AsyncMock(return_value=SimpleNamespace(id="owner-1")),
    )
    record = {
        "id": "pat-1",
        "name": "private deployment key",
        "scopes": ["runs:read"],
        "expires_at": None,
        "created_at": datetime.now(UTC),
    }
    repo = SimpleNamespace(create=AsyncMock(return_value=record))
    from app.gateway import deps

    monkeypatch.setattr(deps, "get_pat_repo", lambda _request: repo)
    request = MagicMock()
    body = auth.PATCreateRequest(name="private deployment key", scopes=["runs:read"])

    response = asyncio.run(call_unwrapped(auth.create_pat, request, body))

    assert response.id == "pat-1"
    assert response.token.startswith("dfp_")
    notify.assert_awaited_once_with(
        request,
        action="auth.pat.create",
        resource_type="personal_access_token",
        resource_id="pat-1",
    )
    assert "private deployment key" not in str(notify.await_args)
    assert "runs:read" not in str(notify.await_args)
    assert response.token not in str(notify.await_args)


def test_pat_revoke_audits_success_but_not_missing_token(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    monkeypatch.setattr(
        auth,
        "get_current_user_from_request",
        AsyncMock(return_value=SimpleNamespace(id="owner-1")),
    )
    repo = SimpleNamespace(revoke=AsyncMock(return_value=True))
    from app.gateway import deps

    monkeypatch.setattr(deps, "get_pat_repo", lambda _request: repo)
    request = MagicMock()

    response = asyncio.run(call_unwrapped(auth.revoke_pat, request, "pat-1"))

    assert response.message == "Token revoked"
    notify.assert_awaited_once_with(
        request,
        action="auth.pat.revoke",
        resource_type="personal_access_token",
        resource_id="pat-1",
    )

    notify.reset_mock()
    repo.revoke.return_value = False
    with pytest.raises(HTTPException) as error:
        asyncio.run(call_unwrapped(auth.revoke_pat, request, "missing-pat"))
    assert error.value.status_code == 404
    notify.assert_not_awaited()


def test_password_change_audits_only_account_id_after_update(monkeypatch):
    from app.gateway.auth import password

    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    monkeypatch.setattr(
        auth,
        "get_current_user_from_request",
        AsyncMock(
            return_value=SimpleNamespace(
                id="owner-1",
                email="old@example.com",
                password_hash="old-hash",
                token_version=4,
                needs_setup=False,
            )
        ),
    )
    monkeypatch.setattr(password, "verify_password_async", AsyncMock(return_value=True))
    monkeypatch.setattr(password, "hash_password_async", AsyncMock(return_value="new-hash"))
    provider = SimpleNamespace(
        get_user_by_email=AsyncMock(return_value=None),
        update_user=AsyncMock(),
    )
    monkeypatch.setattr(auth, "get_local_provider", lambda: provider)
    monkeypatch.setattr(auth, "create_access_token", lambda *_args, **_kwargs: "new-cookie-token")
    monkeypatch.setattr(auth, "_set_session_cookie", MagicMock())
    monkeypatch.setattr(auth, "_set_csrf_cookie", MagicMock())
    request = MagicMock()
    request.state = SimpleNamespace(auth_source="session")
    response = MagicMock()
    body = auth.ChangePasswordRequest(
        current_password="old-password",
        new_password="new-password-7462",
        new_email="new@example.com",
    )

    result = asyncio.run(call_unwrapped(auth.change_password, request, response, body))

    assert result.message == "Password changed successfully"
    provider.update_user.assert_awaited_once()
    notify.assert_awaited_once_with(
        request,
        action="auth.password.change",
        resource_type="account",
        resource_id="owner-1",
    )
    for private_value in ("old-password", "new-password-7462", "new@example.com", "new-hash"):
        assert private_value not in str(notify.await_args)


def test_password_change_failure_does_not_audit(monkeypatch):
    from app.gateway.auth import password

    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    monkeypatch.setattr(
        auth,
        "get_current_user_from_request",
        AsyncMock(
            return_value=SimpleNamespace(
                id="owner-1",
                email="owner@example.test",
                password_hash="old-hash",
                token_version=4,
                needs_setup=False,
            )
        ),
    )
    monkeypatch.setattr(password, "verify_password_async", AsyncMock(return_value=False))
    provider = SimpleNamespace(update_user=AsyncMock())
    monkeypatch.setattr(auth, "get_local_provider", lambda: provider)
    request = MagicMock()
    request.state = SimpleNamespace(auth_source="session")
    response = MagicMock()
    body = auth.ChangePasswordRequest(
        current_password="incorrect-password",
        new_password="new-password-7462",
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(call_unwrapped(auth.change_password, request, response, body))

    assert error.value.status_code == 400
    provider.update_user.assert_not_awaited()
    notify.assert_not_awaited()


def test_register_audits_account_id_after_creation_without_credentials(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    monkeypatch.setattr(auth, "_local_registration_enabled", lambda: True)
    user = SimpleNamespace(
        id="new-user-1",
        email="private@example.com",
        system_role="user",
        oauth_provider=None,
        token_version=0,
    )
    provider = SimpleNamespace(create_user=AsyncMock(return_value=user))
    monkeypatch.setattr(auth, "get_local_provider", lambda: provider)
    monkeypatch.setattr(auth, "create_access_token", lambda *_args, **_kwargs: "private-session-token")
    monkeypatch.setattr(auth, "_set_session_cookie", MagicMock())
    request = MagicMock()
    response = MagicMock()
    body = auth.RegisterRequest(email=user.email, password="private-password-7462")

    result = asyncio.run(call_unwrapped(auth.register, request, response, body))

    assert result.id == user.id
    notify.assert_awaited_once_with(
        request,
        action="auth.account.register",
        resource_type="account",
        resource_id="new-user-1",
        actor_user_id="new-user-1",
    )
    for private_value in (user.email, "private-password-7462", "private-session-token"):
        assert private_value not in str(notify.await_args)


def test_register_failure_does_not_audit_success(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    monkeypatch.setattr(auth, "_local_registration_enabled", lambda: True)
    provider = SimpleNamespace(create_user=AsyncMock(side_effect=ValueError("private@example.com already exists")))
    monkeypatch.setattr(auth, "get_local_provider", lambda: provider)
    request = MagicMock()
    response = MagicMock()
    body = auth.RegisterRequest(email="private@example.com", password="private-password-7462")

    with pytest.raises(HTTPException) as error:
        asyncio.run(call_unwrapped(auth.register, request, response, body))

    assert error.value.status_code == 400
    notify.assert_not_awaited()


def test_initialize_admin_audits_only_new_account_id(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    admin = SimpleNamespace(
        id="first-admin-1",
        email="private-admin@example.com",
        system_role="admin",
        oauth_provider=None,
        token_version=0,
    )
    provider = SimpleNamespace(
        count_admin_users=AsyncMock(return_value=0),
        create_user=AsyncMock(return_value=admin),
    )
    monkeypatch.setattr(auth, "get_local_provider", lambda: provider)
    monkeypatch.setattr(auth, "create_access_token", lambda *_args, **_kwargs: "private-admin-token")
    monkeypatch.setattr(auth, "_set_session_cookie", MagicMock())
    request = MagicMock()
    response = MagicMock()
    body = auth.InitializeAdminRequest(email=admin.email, password="private-password-7462")

    result = asyncio.run(call_unwrapped(auth.initialize_admin, request, response, body))

    assert result.id == admin.id
    notify.assert_awaited_once_with(
        request,
        action="auth.admin.initialize",
        resource_type="account",
        resource_id="first-admin-1",
        actor_user_id="first-admin-1",
    )
    for private_value in (admin.email, "private-password-7462", "private-admin-token"):
        assert private_value not in str(notify.await_args)


def test_oidc_callback_audits_new_provisioning_and_existing_account_login(monkeypatch):
    from app.gateway.auth.oidc import OIDCIdentity
    from deerflow.config import app_config

    notify = AsyncMock()
    monkeypatch.setattr(auth, "notify_action_audit", notify)
    provider_config = SimpleNamespace(
        client_id="private-client-id",
        client_secret="private-client-secret",
        issuer="https://issuer.example",
        authorization_endpoint="https://issuer.example/authorize",
        token_endpoint="https://issuer.example/token",
        userinfo_endpoint="https://issuer.example/userinfo",
        jwks_uri="https://issuer.example/jwks",
        token_endpoint_auth_method="client_secret_post",
        iam_token_vault_enabled=False,
    )
    oidc_config = SimpleNamespace(
        enabled=True,
        providers={"keycloak": provider_config},
        frontend_base_url="https://desk.example",
    )
    monkeypatch.setattr(app_config, "get_app_config", lambda: SimpleNamespace(auth=SimpleNamespace(oidc=oidc_config)))
    monkeypatch.setattr(
        auth,
        "get_state_cookie",
        lambda *_args: SimpleNamespace(
            state="state-1",
            nonce="nonce-1",
            code_verifier="private-verifier",
            next_path="/workspace",
            remember_me=True,
        ),
    )
    monkeypatch.setattr(auth, "_resolve_oidc_redirect_uri", lambda *_args: "https://desk.example/callback/keycloak")
    service = SimpleNamespace(
        discover=AsyncMock(return_value={"issuer": provider_config.issuer}),
        authenticate_callback=AsyncMock(
            return_value=SimpleNamespace(
                identity=OIDCIdentity(
                    provider="keycloak",
                    subject="private-subject",
                    email="private@example.com",
                    email_verified=True,
                    name=None,
                    claims={},
                )
            )
        ),
    )
    monkeypatch.setattr(auth, "_get_oidc_service", lambda: service)
    account = SimpleNamespace(id="oidc-user-1", token_version=0)
    provision = AsyncMock(return_value={"user": account, "created": True})
    monkeypatch.setattr(auth, "get_or_provision_oidc_user", provision)
    monkeypatch.setattr(auth, "get_local_provider", lambda: object())
    monkeypatch.setattr(auth, "create_access_token", lambda *_args, **_kwargs: "private-session-token")
    monkeypatch.setattr(auth, "_set_session_cookie", MagicMock())
    monkeypatch.setattr(auth, "_set_csrf_cookie", MagicMock())
    monkeypatch.setattr(auth, "delete_state_cookie", MagicMock())
    request = MagicMock()

    created_response = asyncio.run(call_unwrapped(auth.oauth_callback, request, "keycloak", "private-code", "state-1"))

    assert created_response.status_code == 302
    notify.assert_awaited_once_with(
        request,
        action="auth.oidc.provision",
        resource_type="account",
        resource_id="oidc-user-1",
        actor_user_id="oidc-user-1",
    )
    for private_value in ("private@example.com", "private-subject", "private-code", "private-session-token"):
        assert private_value not in str(notify.await_args)

    notify.reset_mock()
    provision.return_value = {"user": account, "created": False}
    existing_response = asyncio.run(call_unwrapped(auth.oauth_callback, request, "keycloak", "private-code", "state-1"))

    assert existing_response.status_code == 302
    notify.assert_awaited_once_with(
        request,
        action="auth.oidc.login",
        resource_type="account",
        resource_id="oidc-user-1",
        actor_user_id="oidc-user-1",
    )
    for private_value in ("private@example.com", "private-subject", "private-code", "private-session-token"):
        assert private_value not in str(notify.await_args)


def test_upload_delete_notifies_audit_without_persisting_filename(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(uploads, "notify_action_audit", notify)
    monkeypatch.setattr(uploads, "run_file_io", AsyncMock(return_value={"success": True}))
    request = MagicMock()

    result = asyncio.run(call_unwrapped(uploads.delete_uploaded_file, "thread-1", "private-name.pdf", request=request))

    assert result == {"success": True}
    notify.assert_awaited_once_with(
        request,
        action="upload.delete",
        resource_type="thread_upload",
        resource_id="thread-1",
    )


def test_upload_create_notifies_audit_without_persisting_filename(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(uploads, "notify_action_audit", notify)
    monkeypatch.setattr(uploads, "get_effective_user_id", lambda: "owner-1")
    monkeypatch.setattr(uploads, "_get_upload_limits", lambda _config: SimpleNamespace(max_files=2))

    class IngestionService:
        def __init__(self, **_kwargs):
            pass

        async def open(self):
            pass

        async def ingest_chunks(self, _chunks, *, display_name):
            assert display_name == "private-name.pdf"
            return {
                "filename": display_name,
                "size": 7,
                "path": "/private/path",
                "virtual_path": "/uploads/private-name.pdf",
                "artifact_url": "/artifact/private-name.pdf",
            }

        async def finalize(self):
            pass

        async def aclose(self):
            pass

    monkeypatch.setattr(uploads, "ThreadUploadIngestionService", IngestionService)
    request = MagicMock()

    response = asyncio.run(
        call_unwrapped(
            uploads.upload_files,
            "thread-1",
            request=request,
            files=[SimpleNamespace(filename="private-name.pdf")],
            config=SimpleNamespace(),
        )
    )

    assert response.success is True
    notify.assert_awaited_once_with(
        request,
        action="upload.create",
        resource_type="thread_upload",
        resource_id="thread-1",
    )


def test_project_document_trash_notifies_audit_after_repository_success(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(project_documents, "notify_action_audit", notify)
    monkeypatch.setattr(project_documents, "_require_project", AsyncMock())
    repo = SimpleNamespace(trash=AsyncMock(return_value=True))
    monkeypatch.setattr(project_documents, "get_project_document_repo", lambda _request: repo)
    request = MagicMock()

    asyncio.run(call_unwrapped(project_documents.delete_project_document, "project-1", "document-1", request=request))

    notify.assert_awaited_once_with(
        request,
        action="project.document.trash",
        resource_type="project_document",
        resource_id="document-1",
    )


def test_thread_delete_notifies_audit_only_after_cleanup(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(threads, "notify_action_audit", notify)
    monkeypatch.setattr(threads, "get_effective_user_id", lambda: "owner-1")

    @asynccontextmanager
    async def empty_lock(*_args, **_kwargs):
        yield

    class RunManager:
        def reserve_thread_operation(self, *_args, **_kwargs):
            return empty_lock()

    monkeypatch.setattr(threads, "goal_thread_lock", empty_lock)
    monkeypatch.setattr(threads, "get_run_manager", lambda _request: RunManager())
    monkeypatch.setattr(
        threads,
        "_delete_thread_data_with_reservation",
        AsyncMock(return_value=ThreadDeleteResponse(success=True, message="deleted")),
    )
    request = MagicMock()

    response = asyncio.run(call_unwrapped(threads.delete_thread_data, "thread-1", request=request))

    assert response.success is True
    notify.assert_awaited_once_with(
        request,
        action="thread.delete",
        resource_type="thread",
        resource_id="thread-1",
    )


def test_thread_create_audits_only_after_metadata_and_checkpoint_commit(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(threads, "notify_action_audit", notify)
    monkeypatch.setattr(threads, "get_trusted_internal_owner_user_id", lambda _request: None)

    record = {
        "status": "idle",
        "created_at": "2026-10-02T00:00:00Z",
        "updated_at": "2026-10-02T00:00:00Z",
        "metadata": {},
    }
    store = SimpleNamespace(
        get=AsyncMock(return_value=None),
        create=AsyncMock(return_value=record),
    )
    checkpointer = SimpleNamespace(aput=AsyncMock())
    monkeypatch.setattr(threads, "get_checkpointer", lambda _request: checkpointer)
    monkeypatch.setattr("app.gateway.deps.get_thread_store", lambda _request: store)
    request = MagicMock()

    response = asyncio.run(
        call_unwrapped(
            threads.create_thread,
            threads.ThreadCreateRequest(thread_id="audit-thread-create"),
            request=request,
        )
    )

    assert response.thread_id == "audit-thread-create"
    checkpointer.aput.assert_awaited_once()
    notify.assert_awaited_once_with(
        request,
        action="thread.create",
        resource_type="thread",
        resource_id="audit-thread-create",
    )


def test_thread_create_idempotent_retry_does_not_emit_duplicate_audit(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(threads, "notify_action_audit", notify)
    monkeypatch.setattr(threads, "get_trusted_internal_owner_user_id", lambda _request: None)
    record = {
        "status": "idle",
        "created_at": "2026-10-02T00:00:00Z",
        "updated_at": "2026-10-02T00:00:00Z",
        "metadata": {},
    }
    store = SimpleNamespace(get=AsyncMock(return_value=record))
    checkpointer = SimpleNamespace(aput=AsyncMock())
    monkeypatch.setattr(threads, "get_checkpointer", lambda _request: checkpointer)
    monkeypatch.setattr("app.gateway.deps.get_thread_store", lambda _request: store)
    request = MagicMock()

    response = asyncio.run(
        call_unwrapped(
            threads.create_thread,
            threads.ThreadCreateRequest(thread_id="audit-thread-existing"),
            request=request,
        )
    )

    assert response.thread_id == "audit-thread-existing"
    checkpointer.aput.assert_not_awaited()
    notify.assert_not_awaited()


def test_thread_branch_audits_the_created_thread_after_reservation(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(threads, "notify_action_audit", notify)

    @asynccontextmanager
    async def empty_lock(*_args, **_kwargs):
        yield

    class RunManager:
        def reserve_thread_operation(self, *_args, **_kwargs):
            return empty_lock()

    response = threads.ThreadBranchResponse(
        thread_id="branch-child",
        parent_thread_id="thread-parent",
        parent_checkpoint_id="checkpoint-private",
        branched_from_message_id="message-private",
        workspace_clone_mode="copied",
        history_seed_mode="seeded",
    )
    monkeypatch.setattr(threads, "goal_thread_lock", empty_lock)
    monkeypatch.setattr(threads, "get_run_manager", lambda _request: RunManager())
    monkeypatch.setattr(
        threads,
        "_branch_thread_with_reservation",
        AsyncMock(return_value=response),
    )
    request = MagicMock()

    result = asyncio.run(
        call_unwrapped(
            threads.branch_thread,
            "thread-parent",
            threads.ThreadBranchRequest(message_id="message-private"),
            request=request,
        )
    )

    assert result is response
    notify.assert_awaited_once_with(
        request,
        action="thread.branch",
        resource_type="thread",
        resource_id="branch-child",
    )


def test_thread_metadata_update_audits_without_recording_metadata(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(threads, "notify_action_audit", notify)
    record = {
        "status": "idle",
        "created_at": "2026-10-02T00:00:00Z",
        "updated_at": "2026-10-02T00:00:00Z",
        "metadata": {"title": "private title"},
    }
    store = SimpleNamespace(
        get=AsyncMock(side_effect=[record, record]),
        update_metadata=AsyncMock(),
    )
    monkeypatch.setattr("app.gateway.deps.get_thread_store", lambda _request: store)
    request = MagicMock()

    asyncio.run(
        call_unwrapped(
            threads.patch_thread,
            "thread-1",
            threads.ThreadPatchRequest(metadata={"title": "private title"}),
            request=request,
        )
    )

    notify.assert_awaited_once_with(
        request,
        action="thread.update",
        resource_type="thread",
        resource_id="thread-1",
    )


def test_thread_project_move_audits_thread_id_but_not_target_project(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(threads, "notify_action_audit", notify)
    record = {
        "status": "idle",
        "created_at": "2026-10-02T00:00:00Z",
        "updated_at": "2026-10-02T00:00:00Z",
        "metadata": {},
    }
    store = SimpleNamespace(
        set_project=AsyncMock(return_value=True),
        get=AsyncMock(return_value=record),
    )
    monkeypatch.setattr("app.gateway.deps.get_thread_store", lambda _request: store)
    request = MagicMock()

    asyncio.run(
        call_unwrapped(
            threads.move_thread,
            "thread-1",
            threads.ThreadMoveRequest(project_id="private-project-id"),
            request=request,
        )
    )

    notify.assert_awaited_once_with(
        request,
        action="thread.move",
        resource_type="thread",
        resource_id="thread-1",
    )


def test_project_document_restore_and_purge_are_audited_after_success(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(trash, "notify_action_audit", notify)
    monkeypatch.setattr(action_audit, "get_effective_user_id", lambda: "owner-1")
    monkeypatch.setattr(trash, "get_paths", MagicMock())
    monkeypatch.setattr(
        trash,
        "get_auth_context",
        lambda _request: SimpleNamespace(require_user=lambda: SimpleNamespace(id="owner-1")),
    )
    monkeypatch.setattr(trash, "require_iam_data_scope_for_request", AsyncMock())
    repo = SimpleNamespace(
        get=AsyncMock(return_value={"project_id": "project-1", "trash_origin": {"project_id": "project-1"}}),
        purge=AsyncMock(return_value=True),
    )
    monkeypatch.setattr(trash, "get_project_document_repo", lambda _request: repo)
    restored = {
        "id": "document-1",
        "name": "private-name.pdf",
        "size_bytes": 9,
        "sha256": "sha256",
        "created_at": "now",
        "updated_at": "now",
    }
    monkeypatch.setattr(trash, "restore_document", AsyncMock(return_value=("restored", restored)))
    request = MagicMock()

    response = asyncio.run(
        call_unwrapped(
            trash.restore_trash_document,
            "document-1",
            request=request,
            body=trash.RestoreRequest(project_id="project-1"),
        )
    )

    assert response.outcome == "restored"
    notify.assert_awaited_once_with(
        request,
        action="project.document.restore",
        resource_type="project_document",
        resource_id="document-1",
    )

    notify.reset_mock()
    monkeypatch.setattr(trash, "make_purge_file_remover", lambda *_args, **_kwargs: "remove")
    asyncio.run(call_unwrapped(trash.purge_trash_document, "document-1", request=request))
    notify.assert_awaited_once_with(
        request,
        action="project.document.purge",
        resource_type="project_document",
        resource_id="document-1",
    )


def test_empty_project_trash_audits_full_and_partial_results(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(trash, "notify_action_audit", notify)
    monkeypatch.setattr(action_audit, "get_effective_user_id", lambda: "owner-1")
    monkeypatch.setattr(trash, "get_project_document_repo", lambda _request: object())
    monkeypatch.setattr(trash, "get_paths", MagicMock())
    purge = AsyncMock(return_value=3)
    monkeypatch.setattr(trash, "purge_all_trashed", purge)
    request = MagicMock()

    response = asyncio.run(call_unwrapped(trash.empty_trash, request=request))

    assert response.purged == 3
    notify.assert_awaited_once_with(
        request,
        action="project.trash.empty",
        resource_type="project_trash",
        resource_id=None,
    )

    notify.reset_mock()
    purge.side_effect = OSError("disk error")
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(call_unwrapped(trash.empty_trash, request=request))
    assert exc_info.value.status_code == 500
    notify.assert_awaited_once_with(
        request,
        action="project.trash.empty",
        resource_type="project_trash",
        resource_id=None,
        outcome="failure",
    )


def test_project_crud_and_lifecycle_actions_are_audited_without_project_content(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(projects, "notify_action_audit", notify)
    row = {
        "id": "project-1",
        "name": "private project title",
        "instructions": "private project instructions",
        "presentation": {},
        "status": "active",
        "created_at": "now",
        "updated_at": "now",
    }
    repo = SimpleNamespace(
        create=AsyncMock(return_value=row),
        patch=AsyncMock(return_value=row),
        set_status=AsyncMock(side_effect=[row, row]),
        delete=AsyncMock(return_value=True),
    )
    monkeypatch.setattr(projects, "get_project_repo", lambda _request: repo)
    request = MagicMock()

    asyncio.run(call_unwrapped(projects.create_project, projects.ProjectCreateRequest(name=row["name"]), request))
    asyncio.run(call_unwrapped(projects.patch_project, "project-1", projects.ProjectPatchRequest(name=row["name"]), request))
    asyncio.run(call_unwrapped(projects.archive_project, "project-1", request))
    asyncio.run(call_unwrapped(projects.restore_project, "project-1", request))
    asyncio.run(call_unwrapped(projects.delete_project, "project-1", request))

    assert [(call.kwargs["action"], call.kwargs["resource_id"]) for call in notify.await_args_list] == [
        ("project.create", "project-1"),
        ("project.update", "project-1"),
        ("project.archive", "project-1"),
        ("project.restore", "project-1"),
        ("project.delete", "project-1"),
    ]
    assert all("instructions" not in str(call.kwargs) and "private project title" not in str(call.kwargs) for call in notify.await_args_list)


def test_scheduled_task_mutations_audit_ids_without_prompt_or_title(monkeypatch):
    notify = AsyncMock()
    monkeypatch.setattr(scheduled_tasks, "notify_action_audit", notify)
    monkeypatch.setattr(
        scheduled_tasks,
        "get_optional_user_from_request",
        AsyncMock(return_value=SimpleNamespace(id="owner-1")),
    )
    monkeypatch.setattr(scheduled_tasks, "get_scheduled_task_repo", lambda _request: repo)
    request = MagicMock()

    # task rows intentionally contain private fields to prove they never reach the audit callback.
    task = {
        "id": "task-1",
        "status": "enabled",
        "schedule_type": "once",
        "schedule_spec": {},
        "timezone": "UTC",
        "context_mode": "fresh_thread_per_run",
        "thread_id": None,
        "title": "private task title",
        "prompt": "private task prompt",
    }
    repo = SimpleNamespace(
        create=AsyncMock(return_value=task),
        get=AsyncMock(return_value=task),
        get_active_run_status=AsyncMock(return_value=None),
        update=AsyncMock(return_value=task),
        pause_with_queue_cancellation=AsyncMock(return_value="paused"),
        delete_with_queue_cancellation=AsyncMock(return_value="deleted"),
    )
    monkeypatch.setattr(scheduled_tasks, "get_scheduled_task_repo", lambda _request: repo)
    monkeypatch.setattr(scheduled_tasks, "get_config", lambda: SimpleNamespace(scheduler=SimpleNamespace(min_once_delay_seconds=1)))
    monkeypatch.setattr(scheduled_tasks, "resolve_scheduled_task_assistant_id", AsyncMock(return_value="lead_agent"))
    monkeypatch.setattr(scheduled_tasks, "compute_next_run_at", lambda *_args, **_kwargs: datetime.now(UTC) + timedelta(days=1))

    asyncio.run(
        call_unwrapped(
            scheduled_tasks.create_scheduled_task,
            request,
            scheduled_tasks.ScheduledTaskCreateRequest(
                title=task["title"],
                prompt=task["prompt"],
                schedule_type="once",
                schedule_spec={},
                timezone="UTC",
            ),
        )
    )
    asyncio.run(
        call_unwrapped(
            scheduled_tasks.update_scheduled_task,
            "task-1",
            request,
            scheduled_tasks.ScheduledTaskUpdateRequest(title="updated title"),
        )
    )
    asyncio.run(call_unwrapped(scheduled_tasks.pause_scheduled_task, "task-1", request))
    asyncio.run(call_unwrapped(scheduled_tasks.resume_scheduled_task, "task-1", request))

    service = SimpleNamespace(dispatch_task=AsyncMock(return_value={"outcome": "queued"}))
    monkeypatch.setattr(scheduled_tasks, "get_scheduled_task_service", lambda _request: service)
    asyncio.run(call_unwrapped(scheduled_tasks.trigger_scheduled_task, "task-1", request))
    asyncio.run(call_unwrapped(scheduled_tasks.delete_scheduled_task, "task-1", request))

    assert [call.kwargs["action"] for call in notify.await_args_list] == [
        "scheduled_task.create",
        "scheduled_task.update",
        "scheduled_task.pause",
        "scheduled_task.resume",
        "scheduled_task.trigger",
        "scheduled_task.delete",
    ]
    assert all(call.kwargs["resource_type"] == "scheduled_task" for call in notify.await_args_list)
    assert all(call.kwargs["resource_id"] == "task-1" for call in notify.await_args_list)
    assert all("private task title" not in str(call.kwargs) and "private task prompt" not in str(call.kwargs) for call in notify.await_args_list)

    notify.reset_mock()
    service.dispatch_task.return_value = {"outcome": "conflict", "error": "already running"}
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(call_unwrapped(scheduled_tasks.trigger_scheduled_task, "task-1", request))
    assert exc_info.value.status_code == 409
    notify.assert_not_awaited()


def test_skill_archive_install_audits_only_fixed_resource_fields(monkeypatch):
    notify = AsyncMock()
    installed_name = "private-skill-name"
    private_archive_note = "private skill instructions"
    monkeypatch.setattr(skills, "notify_action_audit", notify)
    monkeypatch.setattr(
        skills,
        "_get_user_skill_storage",
        lambda _config: SimpleNamespace(
            ainstall_skill_from_archive=AsyncMock(
                return_value={
                    "success": True,
                    "skill_name": installed_name,
                    "message": private_archive_note,
                }
            )
        ),
    )
    monkeypatch.setattr(skills, "refresh_user_skills_system_prompt_cache_async", AsyncMock())
    monkeypatch.setattr(skills, "get_effective_user_id", lambda: "owner-1")
    request = MagicMock()

    result = asyncio.run(skills._install_skill_archive(MagicMock(), SimpleNamespace(), request))

    assert result.skill_name == installed_name
    notify.assert_awaited_once_with(
        request,
        action="skill.install",
        resource_type="skill",
        resource_id=None,
    )
    assert installed_name not in str(notify.await_args)
    assert private_archive_note not in str(notify.await_args)


def test_custom_skill_edit_audits_success_without_content_and_skips_blocked_edit(monkeypatch):
    from deerflow.skills.types import SkillCategory

    notify = AsyncMock()
    request = MagicMock()
    config = SimpleNamespace()
    old_content = "private old skill instructions"
    new_content = "private replacement skill instructions"
    skill = SimpleNamespace(
        name="private-skill-name",
        description="private skill description",
        license=None,
        category=SkillCategory.CUSTOM,
        enabled=True,
    )
    storage = SimpleNamespace(
        ensure_custom_skill_is_editable=MagicMock(),
        validate_skill_markdown_content=MagicMock(),
        read_custom_skill=MagicMock(side_effect=[old_content, new_content]),
        write_custom_skill=MagicMock(),
        append_history=MagicMock(),
        load_skills=MagicMock(return_value=[skill]),
    )
    monkeypatch.setattr(skills, "notify_action_audit", notify)
    monkeypatch.setattr(skills, "require_admin_user", AsyncMock())
    monkeypatch.setattr(skills, "_get_user_skill_storage", lambda _config: storage)
    monkeypatch.setattr(skills, "_scan_static_skill_markdown_or_raise", AsyncMock(return_value=[]))
    scan = AsyncMock(return_value=SimpleNamespace(decision="allow", reason="clean"))
    monkeypatch.setattr(skills, "scan_skill_content", scan)
    monkeypatch.setattr(skills, "refresh_user_skills_system_prompt_cache_async", AsyncMock())
    monkeypatch.setattr(skills, "get_effective_user_id", lambda: "owner-1")

    result = asyncio.run(
        call_unwrapped(
            skills.update_custom_skill,
            "private-skill-name",
            skills.CustomSkillUpdateRequest(content=new_content),
            request,
            config,
        )
    )

    assert result.content == new_content
    notify.assert_awaited_once_with(
        request,
        action="skill.custom.update",
        resource_type="skill",
        resource_id=None,
    )
    audit_payload = str(notify.await_args)
    assert "private-skill-name" not in audit_payload
    assert old_content not in audit_payload
    assert new_content not in audit_payload

    notify.reset_mock()
    scan.return_value = SimpleNamespace(decision="block", reason="unsafe content")
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            call_unwrapped(
                skills.update_custom_skill,
                "private-skill-name",
                skills.CustomSkillUpdateRequest(content="blocked private instructions"),
                request,
                config,
            )
        )
    assert exc_info.value.status_code == 400
    notify.assert_not_awaited()


def test_custom_skill_delete_audits_only_after_success(monkeypatch):
    notify = AsyncMock()
    request = MagicMock()
    config = SimpleNamespace()
    storage = SimpleNamespace(delete_custom_skill=MagicMock())
    monkeypatch.setattr(skills, "notify_action_audit", notify)
    monkeypatch.setattr(skills, "require_admin_user", AsyncMock())
    monkeypatch.setattr(skills, "_get_user_skill_storage", lambda _config: storage)
    monkeypatch.setattr(skills, "refresh_user_skills_system_prompt_cache_async", AsyncMock())
    monkeypatch.setattr(skills, "get_effective_user_id", lambda: "owner-1")

    result = asyncio.run(call_unwrapped(skills.delete_custom_skill, "private-skill-name", request, config))

    assert result == {"success": True}
    notify.assert_awaited_once_with(
        request,
        action="skill.custom.delete",
        resource_type="skill",
        resource_id=None,
    )
    assert "private-skill-name" not in str(notify.await_args)

    notify.reset_mock()
    storage.delete_custom_skill.side_effect = FileNotFoundError("private-skill-name")
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(call_unwrapped(skills.delete_custom_skill, "private-skill-name", request, config))
    assert exc_info.value.status_code == 404
    notify.assert_not_awaited()


def test_custom_skill_rollback_audits_fixed_action_without_revision_content(monkeypatch):
    from deerflow.skills.types import SkillCategory

    notify = AsyncMock()
    request = MagicMock()
    config = SimpleNamespace()
    old_content = "private rollback instructions"
    current_content = "private current instructions"
    skill = SimpleNamespace(
        name="private-skill-name",
        description="private skill description",
        license=None,
        category=SkillCategory.CUSTOM,
        enabled=True,
    )
    skill_file = SimpleNamespace(exists=MagicMock(return_value=True), read_text=MagicMock(return_value=current_content))
    storage = SimpleNamespace(
        custom_skill_exists=MagicMock(return_value=True),
        read_history=MagicMock(return_value=[{"prev_content": old_content, "ts": "private-revision-time"}]),
        validate_skill_markdown_content=MagicMock(),
        get_custom_skill_file=MagicMock(return_value=skill_file),
        write_custom_skill=MagicMock(),
        append_history=MagicMock(),
        load_skills=MagicMock(return_value=[skill]),
        read_custom_skill=MagicMock(return_value=old_content),
    )
    monkeypatch.setattr(skills, "notify_action_audit", notify)
    monkeypatch.setattr(skills, "require_admin_user", AsyncMock())
    monkeypatch.setattr(skills, "_get_user_skill_storage", lambda _config: storage)
    monkeypatch.setattr(skills, "_scan_static_skill_markdown_or_raise", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        skills,
        "scan_skill_content",
        AsyncMock(return_value=SimpleNamespace(decision="allow", reason="clean")),
    )
    monkeypatch.setattr(skills, "refresh_user_skills_system_prompt_cache_async", AsyncMock())
    monkeypatch.setattr(skills, "get_effective_user_id", lambda: "owner-1")

    result = asyncio.run(
        call_unwrapped(
            skills.rollback_custom_skill,
            "private-skill-name",
            skills.SkillRollbackRequest(history_index=0),
            request,
            config,
        )
    )

    assert result.content == old_content
    notify.assert_awaited_once_with(
        request,
        action="skill.custom.rollback",
        resource_type="skill",
        resource_id=None,
    )
    audit_payload = str(notify.await_args)
    assert "private-skill-name" not in audit_payload
    assert old_content not in audit_payload
    assert current_content not in audit_payload


def test_skill_enable_disable_and_cache_reload_are_audited_without_skill_names(monkeypatch):
    from deerflow.skills.types import SkillCategory

    notify = AsyncMock()
    request = MagicMock()
    config = SimpleNamespace()
    disabled_skill = SimpleNamespace(
        name="private-public-skill",
        description="private public skill description",
        license=None,
        category=SkillCategory.PUBLIC,
        enabled=False,
    )
    enabled_skill = SimpleNamespace(**{**disabled_skill.__dict__, "enabled": True})
    storage = SimpleNamespace(load_skills=MagicMock(side_effect=[[disabled_skill], [enabled_skill], [enabled_skill], [disabled_skill]]))
    monkeypatch.setattr(skills, "notify_action_audit", notify)
    monkeypatch.setattr(skills, "require_admin_user", AsyncMock())
    monkeypatch.setattr(skills, "_get_user_skill_storage", lambda _config: storage)
    monkeypatch.setattr(skills, "_write_extensions_skill_state", MagicMock())
    monkeypatch.setattr(skills, "clear_skills_system_prompt_cache", MagicMock())

    asyncio.run(
        call_unwrapped(
            skills.update_skill,
            "private-public-skill",
            skills.SkillUpdateRequest(enabled=True),
            request,
            config,
        )
    )
    asyncio.run(
        call_unwrapped(
            skills.update_skill,
            "private-public-skill",
            skills.SkillUpdateRequest(enabled=False),
            request,
            config,
        )
    )
    monkeypatch.setattr(skills, "refresh_skills_system_prompt_cache_async", AsyncMock())
    asyncio.run(skills.reload_skills(request))

    assert [call.kwargs["action"] for call in notify.await_args_list] == [
        "skill.enable",
        "skill.disable",
        "skill.reload",
    ]
    assert all(call.kwargs["resource_type"] == "skill" for call in notify.await_args_list)
    assert all(call.kwargs["resource_id"] is None for call in notify.await_args_list)
    assert "private-public-skill" not in str(notify.await_args_list)
