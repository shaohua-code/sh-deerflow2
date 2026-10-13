import { WorkspaceHome } from "@/product/workspace-home";

// 登录和 owner 权限由上层 workspace layout/Gateway 负责；这个文件只接入
// 自有总览页，不复制认证逻辑或线程数据查询。
export default function WorkspacePage() {
  return <WorkspaceHome />;
}
