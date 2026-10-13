/**
 * 设置页只登记当前草稿状态和本地丢弃动作；设置弹窗统一决定何时提示离开。
 * 保存请求不能在这里伪装成可取消，pending 时由弹窗阻止切换和关闭。
 */
export type SettingsUnsavedChanges = {
  isPending: boolean;
  discard: () => void;
};

export type SettingsUnsavedChangesHandler = (
  changes: SettingsUnsavedChanges | null,
) => void;
