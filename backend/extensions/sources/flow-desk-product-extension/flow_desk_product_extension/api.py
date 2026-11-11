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

from flow_desk_product_extension.data_job_authorization import (
    data_job_authorization_key,
    required_data_job_permissions,
)
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
        """读取产品数据库的 owner 快照。

        已有快照过期时先返回当前页，目录重建在后台进行。还没有快照，
        或 refresh=true 时，仍等待本次扫描。内容 URL 仍由 Gateway 下载路由再次校验 owner。
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
        return {
            "api_version": API_VERSION,
            "invalidated": invalidated,
        }

    # ... remaining routes omitted for brevity in this partial sync; full file is in product source
