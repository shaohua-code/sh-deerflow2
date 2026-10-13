import { describe, expect, it } from "@rstest/core";

import { loadTranslations } from "@/core/i18n/translations";

describe("core copy loading", () => {
  it("loads only the requested overseas and domestic copy", async () => {
    const [english, chinese] = await Promise.all([
      loadTranslations("en-US"),
      loadTranslations("zh-CN"),
    ]);
    expect(english.inputBox.disclaimer).toBe("AI can make mistakes");
    expect(chinese.inputBox.disclaimer).toBe(
      "内容由AI生成，重要信息请务必核查",
    );
    expect(english.channels.descriptions.buzz).toBe(
      "Buzz channels and direct messages through your configured agent.",
    );
    expect(chinese.channels.descriptions.buzz).toBe(
      "通过已配置的智能体接收 Buzz 频道消息和私聊。",
    );
    expect(english.uploads.uploadFailed).toBe(
      "Files could not be uploaded. Please try again.",
    );
    expect(chinese.uploads.uploadFailed).toBe("文件上传失败，请稍后重试。");
  });
});
