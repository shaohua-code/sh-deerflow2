# Flow Desk 产品接口契约

本目录记录 Flow Desk 自有前端与 Gateway 产品扩展之间的公开约定。接口统一使用 `/api/product/v1`，与 DeerFlow 的 LangGraph API、公开 Extension API 和宿主数据库迁移分别演进。升级上游时，先确认宿主的公开能力仍能满足本目录，再修改产品实现；不能通过导入宿主私有模块绕过缺失能力。

| 文档                                 | 覆盖范围                                                 |
| ------------------------------------ | -------------------------------------------------------- |
| [数据管理 v1](data-management.v1.md) | 数据任务、导出制品、删除能力发现、分页、错误码及幂等重放 |

文档区分已经存在的源码行为、新增接口约定和仍待验证的边界。契约文档不是运行时校验器，也不代表功能已经完成验收。本轮按源码静态核对；浏览器恢复交互、数据库、多 Gateway 与全项目回归需要在全面改造结束后统一验证。

## 修改与升级规则

- 一般 v1 响应可以增加可选字段，调用方只读取已知字段；新删除能力 DTO 使用严格字段集，升级要求见数据管理第 8 节。新增字段不得携带凭据、宿主路径、租约或其他用户数据。
- 删除已有必需字段、改变字段类型、改变已支持 scope 的含义，或者改变六种公开任务状态，需要明确迁移方案或新的 API 版本。
- 新增稳定 `error_code` 可以继续使用 v1。旧前端须显示本地化通用失败文案，不能因为不认识错误码而丢弃整个任务列表，也不能展示后端异常正文。
- 新增 scope 或任务状态会影响现有前端枚举校验，不属于天然兼容的字段增加；必须协调前后端部署。
- 每次改变契约，同步后端请求模型及公开投影、前端 DTO 与校验器、用户文案和相应回归来源；涉及 DeerFlow 宿主能力时同时更新上游补丁台账。
- owner 由 Gateway principal 解析。请求正文和查询参数不能指定可信用户身份；界面开关与能力发现不替代服务端认证、授权和执行时检查。

## 实现入口

- [前端 DTO、请求适配与结构校验](../../frontend/src/product/api.ts)
- [前端任务错误码映射](../../frontend/src/product/data-job-failure.ts)
- [产品 HTTP 路由与请求模型](../../product/backend-extension/flow_desk_product_extension/api.py)
- [产品仓储、公开任务投影与能力判断](../../product/backend-extension/flow_desk_product_extension/settings.py)
- [数据任务 worker 与制品生成](../../product/backend-extension/flow_desk_product_extension/jobs.py)
- [产品扩展开发说明](../../product/backend-extension/README.md)

跨语言自动契约验证、PostgreSQL 并发及多 Gateway 共享制品目录仍需单独验证；浏览器网络失败恢复已有前端实现，仍需在最终浏览器验收中确认。
