"""独立的 Flow Desk Gateway 扩展入口。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from deerflow_extension_api import ExtensionRegistry, extension

from flow_desk_product_extension.api import build_router
from flow_desk_product_extension.settings import ProductSettingsStore

__all__ = ["install"]


@extension(api="0.2.18", name="flow-desk-product")
def install(registry: ExtensionRegistry, config: Mapping[str, Any]) -> None:
    """注册自有 API 和数据库服务，不把产品业务写入 DeerFlow 核心。"""
    # 路由在扩展加载时构建，service 在 Gateway 数据库准备完成后启动；
    # 两者共享同一个 store 实例，避免每个请求创建连接池或重复跑迁移。
    settings_store = ProductSettingsStore()
    registry.service(settings_store)
    # 账号启停由 Gateway 核心执行；产品只接收不含邮箱/凭据的审计元数据。
    registry.admin_action_observer(settings_store)
    registry.routers((build_router(config, settings_store),))
