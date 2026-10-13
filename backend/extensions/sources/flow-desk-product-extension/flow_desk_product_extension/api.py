"""自有产品 API 契约。

本模块位于 Gateway 扩展包，不侵入 DeerFlow 的 ``backend/app`` 和 Agent
Harness。前端产品页可以在这里演进自己的 HTTP DTO，不需要让 Agent 运行时
依赖品牌或产品管理概念。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as distribution_version
from inspect import getattr_static, iscoroutinefunction
from typing import Annotated, Any, Literal

from deerflow_extension_api import (
    ExtensionDataScopeError,
    require_admin,
    require_data_scope,
    require_permission,
    resolve_principal,
)
from fastapi import APIRouter, Header, HTTPException, Path, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

from flow_desk_product_extension.data_job_authorization import required_data_job_permissions
from flow_desk_product_extension.settings import (
    DataJobIdempotencyConflict,
    DataJobInProgressConflict,
    DataJobRateLimitError,
    ProductConfigVersionConflict,
    ProductSettingsStore,
)

API_VERSION = 1
logger = logging.getLogger(__name__)
DEFAULT_FEATURES: dict[str, bool] = {
    "overview": True,
    "chats": True,
    "agents": True,
    "scheduled_tasks": True,
    "capabilities": True,
    "files": False,
    "data_privacy": False,
    "administration": False,
}
UNIMPLEMENTED_FEATURES = {"data_privacy"}


class PublicProductBrandNames(BaseModel):
    """公开页面仅需的品牌名称；不让 UI 开关或操作者信息越过边界。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    name_zh: str = Field(min_length=1, max_length=80)


class PublicProductBrandResponse(BaseModel):
    """无需登录即可读取的最小品牌 DTO。"""

    model_config = ConfigDict(extra="forbid")

    api_version: Literal[1]
    product: PublicProductBrandNames


class DataDeletionScopes(BaseModel):
    """封闭的删除范围白名单；不暴露宿主路径、配置或能力失败原因。"""

    model_config = ConfigDict(extra="forbid")

    preferences: StrictBool
    memory: StrictBool
    files: StrictBool
    threads: StrictBool
    projects: StrictBool
    agents: StrictBool
    scheduled_tasks: StrictBool


class DataCapabilitiesResponse(BaseModel):
    """页面进入危险确认前使用的提示，不替代任务提交与执行时的 owner 校验。"""

    model_config = ConfigDict(extra="forbid")

    api_version: Literal[1]
    deletion_scopes: DataDeletionScopes


def _product_config(config: Mapping[str, Any]) -> dict[str, Any]:
    """只复制明确允许公开的设置，避免把扩展私有配置或密钥回传给浏览器。"""
    features = dict(DEFAULT_FEATURES)
    configured_features = config.get("features")
    if isinstance(configured_features, Mapping):
        # 忽略未知键和非布尔值，避免把运维密钥或拼写错误的字段回传给浏览器。
        for key in features:
            value = configured_features.get(key)
            if isinstance(value, bool) and not (key in UNIMPLEMENTED_FEATURES and value):
                features[key] = value

    name = config.get("name")
    name_zh = config.get("name_zh")
    return {
        "name": name.strip()[:80] if isinstance(name, str) and name.strip() else "Flow Desk",
        "name_zh": (
            name_zh.strip()[:80] if isinstance(name_zh, str) and name_zh.strip() else "智能工作台"
        ),
        "features": features,
    }


class SettingWrite(BaseModel):
    """单项用户设置请求。仅接受 JSON 值，且限制单项大小，避免无限制写入。"""

    model_config = ConfigDict(extra="forbid")

    value: Any

    @field_validator("value")
    @classmethod
    def validate_json_value(cls, value: Any) -> Any:
        import json

        try:
            encoded = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ValueError("Setting value must be valid JSON") from exc
        if len(encoded) > 64 * 1024:
            raise ValueError("Setting value exceeds the 64 KiB limit")
        return value


class ProductConfigPatch(BaseModel):
    """在线修改白名单产品展示字段；不包含任意 YAML、路径或密钥入口。"""

    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=0)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    name_zh: str | None = Field(default=None, min_length=1, max_length=80)
    features: dict[str, StrictBool] | None = None

    @field_validator("name", "name_zh")
    @classmethod
    def validate_product_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Product names cannot be blank")
        return value.strip() if value is not None else value

    @field_validator("features")
    @classmethod
    def validate_feature_keys(cls, value: dict[str, bool] | None) -> dict[str, bool] | None:
        if value is not None and any(key not in DEFAULT_FEATURES for key in value):
            raise ValueError("Unknown product feature")
        if value is not None and any(
            key in UNIMPLEMENTED_FEATURES and enabled for key, enabled in value.items()
        ):
            raise ValueError("This product feature is not available yet")
        return value

    @model_validator(mode="after")
    def require_a_change(self) -> ProductConfigPatch:
        if not ({"name", "name_zh", "features"} & self.model_fields_set):
            raise ValueError("At least one product setting must be supplied")
        return self


class DataExportRequest(BaseModel):
    """导出只允许选择一个范围；组合包仍标为部分导出，不代表账号全量备份。"""

    model_config = ConfigDict(extra="forbid")

    scope: list[
        Literal[
            "preferences",
            "threads",
            "projects",
            "scheduled_tasks",
            "agents",
            "memory",
            "files",
            "account",
        ]
    ] = Field(default_factory=lambda: ["preferences"], min_length=1, max_length=1)


class DataDeletionRequest(BaseModel):
    """只允许明确支持的删除范围，并要求匹配范围的确认短语。"""

    model_config = ConfigDict(extra="forbid")

    scope: list[
        Literal[
            "preferences",
            "scheduled_tasks",
            "agents",
            "threads",
            "projects",
            "memory",
            "files",
        ]
    ] = Field(default_factory=lambda: ["preferences"], min_length=1, max_length=1)

    confirmation: Literal[
        "DELETE PREFERENCES",
        "DELETE SCHEDULED TASKS",
        "DELETE CUSTOM AGENTS",
        "DELETE THREAD HISTORY",
        "DELETE MY PROJECTS",
        "DELETE MY MEMORY",
        "DELETE MY FILES",
    ]

    @model_validator(mode="after")
    def confirmation_matches_scope(self) -> DataDeletionRequest:
        """不允许用偏好确认短语意外提交计划任务定义删除。"""
        expected = {
            "preferences": "DELETE PREFERENCES",
            "scheduled_tasks": "DELETE SCHEDULED TASKS",
            "agents": "DELETE CUSTOM AGENTS",
            "threads": "DELETE THREAD HISTORY",
            "projects": "DELETE MY PROJECTS",
            "memory": "DELETE MY MEMORY",
            "files": "DELETE MY FILES",
        }[self.scope[0]]
        if self.confirmation != expected:
            raise ValueError("Confirmation phrase does not match deletion scope")
        return self


def _authenticated_user_id(request: Request) -> str:
    """只使用 Gateway 投影的 principal，绝不读取浏览器自报的用户 ID。"""
    principal = resolve_principal(request)
    if principal is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return principal.user_id


def _request_id(request: Request) -> str | None:
    """只把格式受限的 trace ID 写入审计，避免原样记录任意 header 内容。"""
    import re

    candidate = request.headers.get("x-request-id", "")
    return candidate if re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", candidate) else None


def _data_job_artifact_filename(scope: list[str], job_id: str) -> str:
    """用导出范围生成准确文件名，未知旧任务采用中性名称而非误标偏好包。"""
    filenames = {
        ("preferences",): "preferences",
        ("threads",): "conversations-partial",
        ("projects",): "projects-partial",
        ("scheduled_tasks",): "scheduled-tasks-partial",
        ("agents",): "agents-partial",
        ("memory",): "memory-partial",
        ("files",): "files-partial",
        ("account",): "account-export-partial",
    }
    prefix = filenames.get(tuple(scope), "export")
    suffix = "zip" if tuple(scope) == ("account",) else "json"
    return f"flow-desk-{prefix}-{job_id}.{suffix}"


def build_router(
    config: Mapping[str, Any],
    settings_store: ProductSettingsStore | None = None,
) -> APIRouter:
    """扩展加载时构造稳定路由；此时还没有请求上下文或登录用户。"""
    public_config = _product_config(config)
    data_job_config = config.get("data_jobs")
    data_jobs_enabled = (
        isinstance(data_job_config, Mapping) and data_job_config.get("enabled") is True
    )
    router = APIRouter(prefix="/api/product/v1", tags=["product-v1"])

    @router.get("/bootstrap")
    async def read_bootstrap(request: Request) -> dict[str, Any]:
        """返回展示配置和服务端解析出的当前用户身份。

        Gateway 会在扩展路由前执行认证；此处再通过公开扩展接口解析一次
        principal，并在身份缺失时拒绝请求。不要从浏览器请求体或 header
        接收 user_id / 管理员标记，也不要把此接口返回的 UI 开关当作授权。
        """
        principal = resolve_principal(request)
        if principal is None:
            raise HTTPException(status_code=401, detail="Authentication required")

        product = public_config
        if settings_store is not None:
            try:
                runtime = await settings_store.read_product_config()
                product = _merge_product_config(public_config, runtime["config"])
            except RuntimeError as exc:
                raise HTTPException(
                    status_code=503,
                    detail="Product settings storage is not ready",
                ) from exc

        return {
            "api_version": API_VERSION,
            "product": product,
            "user": {"id": principal.user_id, "is_admin": principal.is_admin},
        }

    @router.get("/public-brand", response_model=PublicProductBrandResponse)
    async def read_public_brand() -> dict[str, Any]:
        """公开登录/首页所需的品牌名；不返回功能开关、用户或管理员信息。

        该接口专供未登录的公开页面使用，因此响应严格投影两个展示字段。
        在线配置存储暂不可用时退回部署默认名，认证与其余产品 API 不受影响。
        """
        product = public_config
        if settings_store is not None:
            try:
                runtime = await settings_store.read_product_config()
                product = _merge_product_config(public_config, runtime["config"])
            except Exception as exc:
                # 公开页面只把动态品牌作为增强；数据库未就绪时继续显示源码默认值。
                logger.warning(
                    "Could not read the public product brand; using deployment defaults (%s)",
                    type(exc).__name__,
                )
        return {
            "api_version": API_VERSION,
            "product": {
                "name": product["name"][:80],
                "name_zh": product["name_zh"][:80],
            },
        }

    @router.get("/version")
    async def read_version(request: Request) -> dict[str, Any]:
        """提供用于问题报告和部署盘点的非敏感产品/引擎版本标识。"""
        _authenticated_user_id(request)
        product = public_config
        if settings_store is not None:
            try:
                runtime = await settings_store.read_product_config()
                product = _merge_product_config(public_config, runtime["config"])
            except RuntimeError as exc:
                raise HTTPException(
                    status_code=503,
                    detail="Product settings storage is not ready",
                ) from exc
        return {
            "api_version": API_VERSION,
            "product": {
                "name": product["name"],
                "version": _distribution_version("flow-desk-product-extension"),
            },
            "engine": {
                "name": "DeerFlow",
                "version": _distribution_version("deerflow-harness"),
            },
        }

    @router.get("/files")
    async def list_owner_files(
        request: Request,
        # 文件中心仍使用小页；账号导出最多一次取 10,000 条，避免每页都重扫整份目录。
        limit: Annotated[int, Query(ge=1, le=10_000)] = 50,
        offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
        query: Annotated[str, Query(max_length=200)] = "",
        refresh: Annotated[bool, Query()] = False,
    ) -> dict[str, Any]:
        """读取产品数据库的 owner 快照，首次访问或过期时通过 Gateway reader 更新。

        refresh=true 可请求立即重建快照；内容 URL 仍由 Gateway 下载路由再次校验 owner。
        """
        user_id = _authenticated_user_id(request)
        await _require_file_catalog_access(request)
        store = _require_settings_store(settings_store)
        try:
            page = await store.list_owner_files(
                user_id,
                limit=limit,
                offset=offset,
                query=query,
                refresh=refresh,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="File catalog is not ready") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if page is None:
            raise HTTPException(status_code=503, detail="File catalog is unavailable")

        files = []
        for file in page.files:
            modified_at = None
            if isinstance(file.modified_at, int | float):
                try:
                    modified_at = datetime.fromtimestamp(file.modified_at, tz=UTC).isoformat()
                except (OverflowError, OSError, ValueError):
                    modified_at = None
            files.append(
                {
                    "file_id": file.file_id,
                    "source": file.source,
                    "name": file.name,
                    "size_bytes": file.size_bytes,
                    "artifact_url": file.artifact_url,
                    "modified_at": modified_at,
                    # Only thread uploads require a storage basename for the
                    # existing delete route. Project storage paths stay private.
                    "storage_name": file.storage_name if file.source == "thread_upload" else None,
                    "thread_id": file.thread_id,
                    "thread_name": file.thread_name,
                    "project_id": file.project_id,
                    "project_name": file.project_name,
                    "document_id": file.document_id,
                }
            )
        return {
            "api_version": API_VERSION,
            "files": files,
            "total": page.total,
            "limit": limit,
            "offset": offset,
            "has_more": page.has_more,
            "next_offset": page.next_offset,
            "truncated": page.truncated,
            "failed_count": page.failed_count,
            "coverage_notes": list(page.coverage_notes),
            # 新字段为 additive；旧版扩展返回的 OwnerFilePage 没有持久快照元数据。
            "catalog_updated_at": (
                page.catalog_updated_at.isoformat()
                if isinstance(getattr(page, "catalog_updated_at", None), datetime)
                else None
            ),
            "catalog_stale": bool(getattr(page, "catalog_stale", False)),
            "catalog_refresh_deferred": bool(getattr(page, "catalog_refresh_deferred", False)),
        }

    @router.delete("/files/catalog-entry")
    async def invalidate_owner_file_catalog_entry(
        request: Request,
        file_id: Annotated[str, Query(min_length=1, max_length=8192)],
    ) -> dict[str, Any]:
        """仅清除当前用户已经删除文件的缓存元数据，不触碰 Gateway 文件内容。"""
        user_id = _authenticated_user_id(request)
        await _require_file_catalog_access(request)
        store = _require_settings_store(settings_store)
        try:
            invalidated = await store.invalidate_owner_file_catalog_entry(user_id, file_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="File catalog is not ready") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"api_version": API_VERSION, "invalidated": invalidated}

    @router.get("/settings")
    async def list_settings(request: Request) -> dict[str, Any]:
        """列出当前登录用户自己的设置；user_id 不接受来自请求参数。"""
        user_id = _authenticated_user_id(request)
        await _require_personal_settings_permission(request, "preferences:read")
        if settings_store is None:
            raise HTTPException(status_code=503, detail="Product settings storage is unavailable")
        try:
            settings = await settings_store.list_for_user(user_id)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail="Product settings storage is not ready",
            ) from exc
        return {"api_version": API_VERSION, "settings": settings}

    @router.put("/settings/{key}")
    async def put_setting(
        request: Request,
        key: Annotated[
            str,
            Path(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_.-]*$"),
        ],
        body: SettingWrite = ...,
    ) -> dict[str, Any]:
        """新建或更新一项用户设置，组合键由服务端 principal 和设置 key 构成。"""
        user_id = _authenticated_user_id(request)
        await _require_personal_settings_permission(request, "preferences:write")
        if settings_store is None:
            raise HTTPException(status_code=503, detail="Product settings storage is unavailable")
        try:
            await settings_store.put_for_user(user_id, key, body.value, _request_id(request))
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail="Product settings storage is not ready",
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"api_version": API_VERSION, "key": key, "value": body.value}

    @router.delete("/settings/{key}", status_code=204)
    async def delete_setting(
        request: Request,
        key: Annotated[
            str,
            Path(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_.-]*$"),
        ],
    ) -> Response:
        """只删除当前 principal 名下的 key；没有对应值时同样返回成功。"""
        user_id = _authenticated_user_id(request)
        await _require_personal_settings_permission(request, "preferences:write")
        if settings_store is None:
            raise HTTPException(status_code=503, detail="Product settings storage is unavailable")
        try:
            await settings_store.delete_for_user(user_id, key, _request_id(request))
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail="Product settings storage is not ready",
            ) from exc
        return Response(status_code=204)

    @router.get("/data-capabilities", response_model=DataCapabilitiesResponse)
    async def read_data_capabilities(request: Request) -> DataCapabilitiesResponse:
        """只读取已有同步能力标记，不调用宿主清单、读取或删除操作。

        偏好删除由本扩展实现；其余范围必须由当前 Gateway 显式提供。
        发现结果可能在提交前发生变化，POST 的最终检查与 worker 的 owner
        校验仍是权威边界，前端不能把这份提示当作删除授权。
        """
        _require_data_jobs_enabled(data_jobs_enabled)
        _authenticated_user_id(request)
        store = _require_settings_store(settings_store)
        return DataCapabilitiesResponse(
            api_version=API_VERSION,
            deletion_scopes=DataDeletionScopes(
                preferences=True,
                memory=_read_deletion_capability(store, "can_delete_memory"),
                files=_read_deletion_capability(store, "can_delete_files"),
                threads=_read_deletion_capability(store, "can_delete_thread_history"),
                projects=_read_deletion_capability(store, "can_delete_projects"),
                agents=_read_deletion_capability(store, "can_delete_custom_agents"),
                scheduled_tasks=_read_deletion_capability(
                    store, "can_delete_scheduled_task_definitions"
                ),
            ),
        )

    @router.post("/data-exports", status_code=202)
    async def create_data_export(
        request: Request,
        body: DataExportRequest,
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
    ) -> dict[str, Any]:
        """排入可重试的数据任务；身份只来自 Gateway principal。"""
        _require_data_jobs_enabled(data_jobs_enabled)
        user_id = _authenticated_user_id(request)
        await _require_data_job_permissions(request, "export", body.scope[0])
        store = _require_settings_store(settings_store)
        try:
            job = await store.create_data_job(
                owner_user_id=user_id,
                kind="export",
                idempotency_key=idempotency_key,
                scope=body.scope,
                request_id=_request_id(request),
            )
        except DataJobIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except DataJobInProgressConflict as exc:
            raise HTTPException(
                status_code=409,
                detail="A data operation is already in progress",
            ) from exc
        except DataJobRateLimitError as exc:
            raise HTTPException(
                status_code=429,
                detail="Too many data operations; try again later",
                headers={"Retry-After": str(exc.retry_after_seconds)},
            ) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Product data jobs are not ready") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"api_version": API_VERSION, "job": job}

    @router.post("/data-deletions", status_code=202)
    async def create_data_deletion(
        request: Request,
        body: DataDeletionRequest,
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key")],
    ) -> dict[str, Any]:
        """只提交已明确支持的范围删除任务；不代表完整账号擦除。"""
        _require_data_jobs_enabled(data_jobs_enabled)
        user_id = _authenticated_user_id(request)
        await _require_data_job_permissions(request, "deletion", body.scope[0])
        store = _require_settings_store(settings_store)
        if body.scope == ["scheduled_tasks"] and not getattr(
            store, "can_delete_scheduled_task_definitions", False
        ):
            raise HTTPException(
                status_code=503,
                detail="Scheduled task deletion is unavailable on this Gateway",
            )
        if body.scope == ["agents"] and not getattr(store, "can_delete_custom_agents", False):
            raise HTTPException(
                status_code=503,
                detail="Custom Agent deletion is unavailable on this Gateway",
            )
        if body.scope == ["threads"] and not getattr(store, "can_delete_thread_history", False):
            raise HTTPException(
                status_code=503,
                detail="Thread history deletion is unavailable on this Gateway",
            )
        if body.scope == ["projects"] and not getattr(store, "can_delete_projects", False):
            raise HTTPException(
                status_code=503,
                detail="Project removal is unavailable on this Gateway",
            )
        if body.scope == ["memory"] and not getattr(store, "can_delete_memory", False):
            raise HTTPException(
                status_code=503,
                detail="Memory deletion is unavailable on this Gateway",
            )
        if body.scope == ["files"] and not getattr(store, "can_delete_files", False):
            raise HTTPException(
                status_code=503,
                detail="File deletion is unavailable on this Gateway",
            )
        try:
            job = await store.create_data_job(
                owner_user_id=user_id,
                kind="deletion",
                idempotency_key=idempotency_key,
                scope=body.scope,
                request_id=_request_id(request),
            )
        except DataJobIdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except DataJobInProgressConflict as exc:
            raise HTTPException(
                status_code=409,
                detail="A data operation is already in progress",
            ) from exc
        except DataJobRateLimitError as exc:
            raise HTTPException(
                status_code=429,
                detail="Too many data operations; try again later",
                headers={"Retry-After": str(exc.retry_after_seconds)},
            ) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Product data jobs are not ready") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"api_version": API_VERSION, "job": job}

    @router.get("/data-jobs")
    async def list_data_jobs(
        request: Request,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
    ) -> dict[str, Any]:
        """分页读取当前用户自己的导出/删除任务。"""
        _require_data_jobs_enabled(data_jobs_enabled)
        user_id = _authenticated_user_id(request)
        store = _require_settings_store(settings_store)
        try:
            # 多取一行作为游标哨兵；响应只返回请求页大小，额外一行只用于判断
            # 是否应显示“下一页”，这样恰好 20 条时也不会隐藏后续历史。
            jobs = await store.list_data_jobs(user_id, limit=limit + 1, offset=offset)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Product data jobs are not ready") from exc
        has_more = len(jobs) > limit
        visible_jobs: list[dict[str, Any]] = []
        for job in jobs[:limit]:
            try:
                await _require_data_job_permissions(request, job["kind"], job["scope"][0])
            except HTTPException as exc:
                if exc.status_code == 403:
                    # A revoked route grant or row scope must also hide the old
                    # task summary; the owner check alone is not a current grant.
                    continue
                raise
            visible_jobs.append(job)
        return {
            "api_version": API_VERSION,
            "jobs": visible_jobs,
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
        }

    @router.get("/data-jobs/{job_id}")
    async def read_data_job(
        request: Request,
        job_id: Annotated[str, Path(pattern=r"^[a-f0-9-]{36}$")],
    ) -> dict[str, Any]:
        """未知任务和他人任务一律返回 404，避免泄露任务是否存在。"""
        _require_data_jobs_enabled(data_jobs_enabled)
        user_id = _authenticated_user_id(request)
        store = _require_settings_store(settings_store)
        try:
            job = await store.get_data_job(user_id, job_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Product data jobs are not ready") from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Data job not found")
        await _require_data_job_permissions(request, job["kind"], job["scope"][0])
        return {"api_version": API_VERSION, "job": job}

    @router.post("/data-jobs/{job_id}/cancel")
    async def cancel_data_job(
        request: Request,
        job_id: Annotated[str, Path(pattern=r"^[a-f0-9-]{36}$")],
    ) -> dict[str, Any]:
        """排队任务立即取消；运行中任务由 worker 在安全点读取取消信号。"""
        _require_data_jobs_enabled(data_jobs_enabled)
        user_id = _authenticated_user_id(request)
        store = _require_settings_store(settings_store)
        try:
            job = await store.get_data_job(user_id, job_id)
            if job is None:
                raise HTTPException(status_code=404, detail="Data job not found")
            await _require_data_job_permissions(request, job["kind"], job["scope"][0])
            await store.request_data_job_cancel(
                user_id,
                job_id,
                request_id=_request_id(request),
            )
            job = await store.get_data_job(user_id, job_id)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Product data jobs are not ready") from exc
        if job is None:
            raise HTTPException(status_code=404, detail="Data job not found")
        return {"api_version": API_VERSION, "job": job}

    @router.get("/data-jobs/{job_id}/artifact")
    async def download_data_job_artifact(
        request: Request,
        job_id: Annotated[str, Path(pattern=r"^[a-f0-9-]{36}$")],
    ) -> Response:
        """仅在 owner 身份、完成状态与 24 小时有效期都通过时发送导出文件。"""
        _require_data_jobs_enabled(data_jobs_enabled)
        user_id = _authenticated_user_id(request)
        store = _require_settings_store(settings_store)
        try:
            job = await store.get_data_job(user_id, job_id)
            if job is None:
                raise HTTPException(status_code=404, detail="Data job not found")
            await _require_data_job_permissions(request, job["kind"], job["scope"][0])
            if job["status"] != "completed":
                raise HTTPException(status_code=409, detail="Data job is not complete")
            artifact_path = await store.data_job_artifact_path(
                user_id,
                job_id,
                audit_download=True,
                request_id=_request_id(request),
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="Product data jobs are not ready") from exc
        if artifact_path is None:
            raise HTTPException(status_code=410, detail="Export artifact is unavailable or expired")
        return FileResponse(
            artifact_path,
            media_type=("application/zip" if job["scope"] == ["account"] else "application/json"),
            filename=_data_job_artifact_filename(job["scope"], job_id),
        )

    @router.get("/admin/audit-events")
    async def list_audit_events(
        request: Request,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
    ) -> dict[str, Any]:
        """管理员分页查询元数据审计；PAT 的 admin 权限由宿主 principal 屏蔽。"""
        try:
            require_admin(request)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail="Administrator access required") from exc
        if settings_store is None:
            raise HTTPException(status_code=503, detail="Product audit storage is unavailable")
        try:
            # 多读一条哨兵记录，避免记录数恰好整除 page size 时把管理员带到空白页。
            events = await settings_store.list_audit_events(limit + 1, offset)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail="Product audit storage is not ready",
            ) from exc
        has_more = len(events) > limit
        return {
            "api_version": API_VERSION,
            "events": events[:limit],
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
        }

    @router.get("/admin/settings")
    async def read_admin_settings(request: Request) -> dict[str, Any]:
        """读取可在线编辑的产品名称和 UI 功能提示及当前配置版本。"""
        _require_product_admin(request)
        store = _require_settings_store(settings_store)
        try:
            runtime = await store.read_product_config()
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503, detail="Product settings storage is not ready"
            ) from exc
        return {
            "api_version": API_VERSION,
            "version": runtime["version"],
            "product": _merge_product_config(public_config, runtime["config"]),
        }

    @router.patch("/admin/settings")
    async def patch_admin_settings(
        request: Request,
        body: ProductConfigPatch,
    ) -> dict[str, Any]:
        """更新有限的产品展示字段；必须带上读取时的版本号以避免覆盖。"""
        principal = _require_product_admin(request)
        store = _require_settings_store(settings_store)
        try:
            runtime = await store.read_product_config()
            current_product = _merge_product_config(public_config, runtime["config"])
            patch = body.model_dump(exclude={"expected_version"}, exclude_unset=True)
            next_product = dict(current_product)
            if "features" in patch:
                next_product["features"] = {
                    **current_product["features"],
                    **(patch["features"] or {}),
                }
            if "name" in patch:
                next_product["name"] = patch["name"]
            if "name_zh" in patch:
                next_product["name_zh"] = patch["name_zh"]
            saved = await store.patch_product_config(
                next_product,
                body.expected_version,
                principal.user_id,
                _request_id(request),
            )
        except ProductConfigVersionConflict as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Product settings changed; reload before saving",
                    "version": exc.current_version,
                },
            ) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503, detail="Product settings storage is not ready"
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {
            "api_version": API_VERSION,
            "version": saved["version"],
            "product": _merge_product_config(public_config, saved["config"]),
        }

    return router


def _require_product_admin(request: Request):
    """将扩展 API 的宿主管理员投影统一映射为 HTTP 403。"""
    try:
        return require_admin(request)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="Administrator access required") from exc


async def _require_file_catalog_access(request: Request) -> None:
    """Require both route grants and matching Central IAM row scopes."""
    await _require_permissions_and_data_scopes(
        request,
        ("threads:read", "projects:read"),
        detail="File catalog read permission required",
    )


async def _require_personal_settings_permission(request: Request, permission: str) -> None:
    """产品个人偏好与 Gateway 偏好 API 共用路由授权和 owner data scope。"""
    try:
        require_permission(request, permission)
    except PermissionError as exc:
        raise HTTPException(
            status_code=403,
            detail="Product settings permission required",
        ) from exc
    await _require_extension_data_scope(
        request,
        target=permission,
        action=permission.partition(":")[2],
    )


async def _require_data_job_permissions(request: Request, kind: str, scope: str) -> None:
    """Recheck the current Gateway grants for each data range an operation touches.

    These checks are repeated for artifact downloads, job details, and cancel
    requests so a previously authorized task does not keep its old access after
    an administrator revokes the user's permission.
    """
    required = required_data_job_permissions(kind, scope)

    if not required:
        raise HTTPException(status_code=403, detail="Data operation permission required")

    await _require_permissions_and_data_scopes(
        request,
        required,
        detail="Data operation permission required",
    )


async def _require_permissions_and_data_scopes(
    request: Request,
    permissions: tuple[str, ...],
    *,
    detail: str,
) -> None:
    """Apply route grants and Central IAM scopes before product data access."""
    try:
        for permission in permissions:
            require_permission(request, permission)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=detail) from exc

    for permission in permissions:
        await _require_extension_data_scope(
            request,
            target=permission,
            action=permission.partition(":")[2],
        )


async def _require_extension_data_scope(
    request: Request,
    *,
    target: str,
    action: str,
    resource_id: str | None = None,
) -> None:
    """Translate the framework-free public extension error into an HTTP result."""
    try:
        await require_data_scope(
            request,
            target=target,
            action=action,
            resource_id=resource_id,
        )
    except ExtensionDataScopeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


def _require_data_jobs_enabled(enabled: bool) -> None:
    """运行任务需由可信 operator 配置显式打开；前端功能开关不会替代它。"""
    if not enabled:
        raise HTTPException(status_code=404, detail="Data operations are not enabled")


def _require_settings_store(store: ProductSettingsStore | None) -> ProductSettingsStore:
    if store is None:
        raise HTTPException(status_code=503, detail="Product settings storage is unavailable")
    return store


def _read_deletion_capability(store: ProductSettingsStore, attribute: str) -> bool:
    """仅接受严格的同步布尔投影；异常或错误类型均关闭该范围。

    旧 Gateway 缺少可选能力属于正常的 False。异步 getter 和方法对象不应
    被当作真值，更不能为了发现能力而执行宿主操作；日志也只记录稳定属性
    名与异常类型，不包含配置、路径或异常正文。
    """
    try:
        descriptor = getattr_static(store, attribute, False)
        if isinstance(descriptor, property) and iscoroutinefunction(descriptor.fget):
            logger.warning("Asynchronous deletion capability %s is unavailable", attribute)
            return False
        value = getattr(store, attribute, False)
    except Exception as exc:
        logger.warning(
            "Could not project deletion capability %s (%s)", attribute, type(exc).__name__
        )
        return False
    if type(value) is not bool:
        logger.warning(
            "Invalid deletion capability %s (%s); treating as unavailable",
            attribute,
            type(value).__name__,
        )
        return False
    return value


def _distribution_version(name: str) -> str:
    """开发态源码测试可能没有安装分发包元数据，此时明确返回 unknown。"""
    try:
        return distribution_version(name)
    except PackageNotFoundError:
        return "unknown"


def _merge_product_config(
    defaults: dict[str, Any],
    override: Mapping[str, Any],
) -> dict[str, Any]:
    """只应用已知展示字段，数据库中意外出现的额外值也不会下发到浏览器。"""
    features = dict(defaults["features"])
    configured_features = override.get("features")
    if isinstance(configured_features, Mapping):
        for key in features:
            value = configured_features.get(key)
            if isinstance(value, bool) and not (key in UNIMPLEMENTED_FEATURES and value):
                features[key] = value
    result = {**defaults, "features": features}
    for key in ("name", "name_zh"):
        candidate = override.get(key)
        if isinstance(candidate, str) and candidate.strip():
            result[key] = candidate.strip()[:80]
    return result
