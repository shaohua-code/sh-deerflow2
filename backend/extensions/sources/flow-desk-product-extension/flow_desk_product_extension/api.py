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
