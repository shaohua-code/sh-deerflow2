/**
 * IAM 资源树已登记的按钮码（与 IAM 管理台「资源权限」中的 button 节点一一对应）。
 * 新增受控按钮时在此登记，并在 IAM 资源树下创建同名 button 节点。
 */
export const IAM_BUTTON_CODES = {
  /** 新建会话：侧栏按钮、命令面板、总览与项目页入口，以及新会话页的输入框。 */
  chatCreate: "deerflow.chats.new",
  /** 停止生成：普通会话与智能体会话的停止按钮。 */
  runCancel: "deerflow.runs.cancel",
} as const;

export type IamButtonCode =
  (typeof IAM_BUTTON_CODES)[keyof typeof IAM_BUTTON_CODES];

/** 受控结果：仅含 IAM 资源树已下发的菜单码与按钮码。 */
export type IamResourceControl = {
  menus: readonly string[];
  buttons: readonly string[];
};

/**
 * IAM 资源管控的三态：
 * - undefined：尚未解析完成。受控结果未知时不渲染受控项，避免未授权的菜单/按钮先闪现再收起。
 * - null：未受控——未登录、静态站点、纯本地账号、IAM 明示不受控或请求失败降级，此时全量显示
 *   （只有 IAM 会话受菜单/按钮管控，其余一切不做权限管控）。
 * - 对象：受控。
 */
export type IamResourceControlState = IamResourceControl | null | undefined;

/** 菜单是否可见：未受控放行；解析中不放行；受控时以 IAM 是否下发该菜单码为准。 */
export function isIamMenuGranted(
  control: IamResourceControlState,
  code: string,
): boolean {
  return control === null || control?.menus.includes(code) === true;
}

/** 按钮是否可用，口径与 isIamMenuGranted 一致。 */
export function isIamButtonGranted(
  control: IamResourceControlState,
  code: IamButtonCode,
): boolean {
  return control === null || control?.buttons.includes(code) === true;
}
