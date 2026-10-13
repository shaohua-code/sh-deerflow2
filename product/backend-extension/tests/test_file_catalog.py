from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from deerflow_extension_api import ExtensionRuntimeDeps, OwnerFileEntry, OwnerFilePage
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import flow_desk_product_extension.settings as settings_module
from flow_desk_product_extension.settings import (
    ProductSettingsStore,
    _file_catalog_entry_values,
)


class MutableFileReader:
    def __init__(self, entries: list[OwnerFileEntry]) -> None:
        self.entries = entries
        self.calls = 0
        self.fail = False

    async def list_files(self, *, user_id: str, limit: int, offset: int, query: str = ""):
        self.calls += 1
        if self.fail:
            raise RuntimeError("private gateway failure detail")
        assert user_id in {"user-a", "user-b"}
        return OwnerFilePage(
            files=tuple(self.entries[:limit]),
            total=len(self.entries),
            has_more=False,
            next_offset=None,
            coverage_notes=("bounded scan",),
        )


def _entry(file_id: str, name: str) -> OwnerFileEntry:
    return OwnerFileEntry(
        file_id=file_id,
        source="thread_upload",
        name=name,
        size_bytes=12,
        artifact_url=f"/api/threads/thread-1/uploads/{name}",
        modified_at=1_797_000_000,
        storage_name=name,
        thread_id="thread-1",
        thread_name="Planning",
    )


def test_file_catalog_metadata_projection_never_keeps_project_storage_paths() -> None:
    project_file = OwnerFileEntry(
        file_id="project-document:project-1:doc-1",
        source="project_document",
        name="spec.pdf",
        size_bytes=12,
        artifact_url="/api/projects/project-1/documents/doc-1/content?download=true",
        storage_name="private/host/path/spec.pdf",
        project_id="project-1",
        project_name="Planning",
        document_id="doc-1",
    )

    projected = _file_catalog_entry_values(project_file)

    assert projected["storage_name"] is None
    assert "private/host/path" not in str(projected)
    assert "content" not in projected


def test_file_catalog_metadata_projection_rejects_external_artifact_urls() -> None:
    file = OwnerFileEntry(
        file_id="upload:external",
        source="thread_upload",
        name="notes.txt",
        size_bytes=1,
        artifact_url="//example.com/private-file",
    )

    with pytest.raises(ValueError, match="owner-checked artifact URL"):
        _file_catalog_entry_values(file)


def test_catalog_snapshot_persists_scopes_search_and_refreshes_atomically(monkeypatch) -> None:
    # 该用例检查快照替换语义；刷新频控由独立回归覆盖，不需要等待 30 秒。
    monkeypatch.setattr(settings_module, "_FILE_CATALOG_REFRESH_INTERVAL", timedelta(0))

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        reader = MutableFileReader(
            [_entry("upload:a", "Alpha.pdf"), _entry("upload:b", "notes.md")]
        )
        deps = ExtensionRuntimeDeps(
            session_factory=session_factory,
            owner_data_reader=reader,
        )
        store = ProductSettingsStore()

        try:
            await store.start(deps)
            first = await store.list_owner_files("user-a", limit=1, offset=0)
            assert first is not None
            assert [file.name for file in first.files] == ["Alpha.pdf"]
            assert first.total == 2
            assert first.has_more is True
            assert reader.calls == 1

            searched = await store.list_owner_files(
                "user-a",
                limit=10,
                offset=0,
                query="ALPHA",
            )
            assert searched is not None
            assert [file.name for file in searched.files] == ["Alpha.pdf"]
            assert reader.calls == 1

            # 新扩展实例仍从自有数据库读取快照，不需要重新扫描宿主目录。
            await store.stop()
            offline_reader = MutableFileReader([])
            restarted = ProductSettingsStore()
            await restarted.start(
                ExtensionRuntimeDeps(
                    session_factory=session_factory,
                    owner_data_reader=offline_reader,
                )
            )
            restored = await restarted.list_owner_files("user-a", limit=10, offset=0)
            assert restored is not None
            assert [file.name for file in restored.files] == ["Alpha.pdf", "notes.md"]
            assert offline_reader.calls == 0

            # 强制刷新会以新快照替换旧快照，不能把已移除文件继续留在目录里。
            offline_reader.entries = [_entry("upload:c", "current.csv")]
            refreshed = await restarted.list_owner_files(
                "user-a",
                limit=10,
                offset=0,
                refresh=True,
            )
            assert refreshed is not None
            assert [file.name for file in refreshed.files] == ["current.csv"]
            assert offline_reader.calls == 1

            # 其他用户的索引始终独立；刷新失败时仅回退到本人上一次快照。
            offline_reader.entries = [_entry("upload:other", "other-user.txt")]
            other = await restarted.list_owner_files("user-b", limit=10, offset=0)
            assert other is not None
            assert [file.name for file in other.files] == ["other-user.txt"]
            assert [file.name for file in refreshed.files] == ["current.csv"]

            offline_reader.fail = True
            stale = await restarted.list_owner_files(
                "user-a",
                limit=10,
                offset=0,
                refresh=True,
            )
            assert stale is not None
            assert [file.name for file in stale.files] == ["current.csv"]
            assert stale.catalog_stale is True
            assert "private gateway failure detail" not in str(stale.coverage_notes)
        finally:
            await store.stop()
            await engine.dispose()

    asyncio.run(run())


def test_manual_refresh_inside_cooldown_keeps_snapshot_and_reports_deferred() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        reader = MutableFileReader([_entry("upload:a", "Alpha.pdf")])
        store = ProductSettingsStore()
        try:
            await store.start(
                ExtensionRuntimeDeps(
                    session_factory=session_factory,
                    owner_data_reader=reader,
                )
            )
            first = await store.list_owner_files("user-a", limit=10, offset=0)
            deferred = await store.list_owner_files(
                "user-a",
                limit=10,
                offset=0,
                refresh=True,
            )
            assert first is not None and deferred is not None
            assert [file.name for file in deferred.files] == ["Alpha.pdf"]
            assert deferred.catalog_refresh_deferred is True
            assert reader.calls == 1
        finally:
            await store.stop()
            await engine.dispose()

    asyncio.run(run())


def test_gateway_delete_invalidates_only_the_owner_cached_entry() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        reader = MutableFileReader(
            [_entry("upload:a", "Alpha.pdf"), _entry("upload:b", "notes.md")]
        )
        store = ProductSettingsStore()
        try:
            await store.start(
                ExtensionRuntimeDeps(
                    session_factory=session_factory,
                    owner_data_reader=reader,
                )
            )
            await store.list_owner_files("user-a", limit=10, offset=0)
            invalidated = await store.invalidate_owner_file_catalog_entry(
                "user-a",
                "upload:a",
            )
            remaining = await store.list_owner_files("user-a", limit=10, offset=0)

            assert invalidated is True
            assert remaining is not None
            assert [file.name for file in remaining.files] == ["notes.md"]
            assert remaining.catalog_stale is True
            assert reader.calls == 1

            other = await store.list_owner_files("user-b", limit=10, offset=0)
            assert other is not None
            assert [file.name for file in other.files] == ["Alpha.pdf", "notes.md"]
        finally:
            await store.stop()
            await engine.dispose()

    asyncio.run(run())
