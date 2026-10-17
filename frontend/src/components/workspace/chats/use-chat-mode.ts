import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useI18n } from "@/core/i18n/hooks";

/**
 * Hook to determine if the chat is in a specific mode based on URL parameters, and to set an initial prompt input value accordingly.
 */
export function useSpecificChatMode() {
  const { t } = useI18n();
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const searchParams = useSearchParams();
  const promptInputController = usePromptInputController();
  const inputInitialValue = useMemo(() => {
    if (threadIdFromPath !== "new" || searchParams.get("mode") !== "skill") {
      return undefined;
    }
    return t.inputBox.createSkillPrompt;
  }, [threadIdFromPath, searchParams, t.inputBox.createSkillPrompt]);
  const lastInitialValueRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // 延迟聚焦期间控制器可能更替，把当前 setter 捕获到 effect 局部，
    // 避免渲染期写 ref；同时清理定时器防止组件卸载后写入。
    const setInput = promptInputController.textInput.setInput;
    if (
      inputInitialValue &&
      inputInitialValue !== lastInitialValueRef.current
    ) {
      lastInitialValueRef.current = inputInitialValue;
      const timer = setTimeout(() => {
        setInput(inputInitialValue);
        const textarea = document.querySelector("textarea");
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.value.length;
          textarea.selectionEnd = textarea.value.length;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [inputInitialValue, promptInputController.textInput.setInput]);
}
