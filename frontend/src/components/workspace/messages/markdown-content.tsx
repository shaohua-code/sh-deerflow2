"use client";

import {
  createContext,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useContext,
  useDeferredValue,
  useMemo,
} from "react";

import { type ClipboardSafeStreamdownProps } from "@/components/ai-elements/streamdown";
import {
  preprocessStreamdownMarkdown,
  rehypeStreamingListItems,
  streamdownPluginsWithoutRawHtml,
  streamdownSmoothStreamingAnimation,
} from "@/core/streamdown";
import {
  SafeMessageResponse,
  type StreamdownComponentOverrides,
  toStreamdownComponents,
} from "@/core/streamdown/components";
import { cn } from "@/lib/utils";

import { createMarkdownLinkComponent } from "./markdown-link";
import { useSmoothStreamingContent } from "./use-smooth-streaming-content";

export type MarkdownContentProps = {
  content: string;
  isLoading: boolean;
  rehypePlugins?: ClipboardSafeStreamdownProps["rehypePlugins"];
  className?: string;
  remarkPlugins?: ClipboardSafeStreamdownProps["remarkPlugins"];
  components?: StreamdownComponentOverrides;
};

type StreamingCodeProps = ComponentProps<"code"> & {
  node?: unknown;
  children?: ReactNode;
};

const StreamingCodeBlockContext = createContext(false);

function StreamingPre({ children }: ComponentProps<"pre">) {
  const childClassName = isValidElement<{ className?: string }>(children)
    ? children.props.className
    : undefined;
  const language =
    /(?:^|\s)language-([^\s]+)/.exec(childClassName ?? "")?.[1] ?? "";

  return (
    <div
      className="my-4 w-full overflow-hidden rounded-xl border"
      data-language={language}
      data-streaming-code-block="true"
    >
      {language && (
        <div className="bg-muted/80 text-muted-foreground p-3 text-xs">
          <span className="ml-1 font-mono lowercase">{language}</span>
        </div>
      )}
      <pre className="bg-muted/40 overflow-x-auto border-t p-4 font-mono text-xs">
        <StreamingCodeBlockContext.Provider value={true}>
          {children}
        </StreamingCodeBlockContext.Provider>
      </pre>
    </div>
  );
}

function StreamingCode({
  children,
  className,
  node: _node,
  ...props
}: StreamingCodeProps) {
  const isBlock = useContext(StreamingCodeBlockContext);

  if (!isBlock) {
    return (
      <code
        {...props}
        className={cn(
          "bg-muted rounded px-1.5 py-0.5 font-mono text-sm",
          className,
        )}
        data-streaming-inline-code="true"
      >
        {children}
      </code>
    );
  }

  return (
    <code {...props} className={className}>
      {children}
    </code>
  );
}

/** Renders markdown content. */
export function MarkdownContent({
  content,
  isLoading,
  rehypePlugins,
  className,
  remarkPlugins = streamdownPluginsWithoutRawHtml.remarkPlugins,
  components: componentsFromProps,
}: MarkdownContentProps) {
  const deferredContent = useDeferredValue(content);
  const targetContent = isLoading ? deferredContent : content;
  const { content: displayContent, isRevealing } = useSmoothStreamingContent(
    targetContent,
    isLoading,
  );
  const isStreamingRender = isLoading || isRevealing;
  const normalizedContent = useMemo(
    () => preprocessStreamdownMarkdown(displayContent),
    [displayContent],
  );
  const effectiveRehypePlugins = useMemo(() => {
    const base = streamdownPluginsWithoutRawHtml.rehypePlugins ?? [];
    const extra = rehypePlugins ?? [];
    const streaming = isStreamingRender ? [rehypeStreamingListItems] : [];
    return [
      ...base,
      ...extra,
      ...streaming,
    ] as ClipboardSafeStreamdownProps["rehypePlugins"];
  }, [isStreamingRender, rehypePlugins]);
  const components = useMemo(() => {
    const baseComponents = {
      a: createMarkdownLinkComponent(),
      ...componentsFromProps,
    };
    if (!isStreamingRender) {
      return baseComponents;
    }
    return {
      ...baseComponents,
      code: componentsFromProps?.code ?? StreamingCode,
      pre: componentsFromProps?.pre ?? StreamingPre,
    };
  }, [componentsFromProps, isStreamingRender]);

  if (!displayContent) return null;

  return (
    <SafeMessageResponse
      className={className}
      remarkPlugins={remarkPlugins}
      rehypePlugins={effectiveRehypePlugins}
      components={toStreamdownComponents(components)}
      // 流结束后仍在逐字显示时，已显示内容的末尾一样可能停在未闭合的标记中间，继续按不完整 Markdown 解析
      parseIncompleteMarkdown={isStreamingRender}
      animated={streamdownSmoothStreamingAnimation}
      isAnimating={isLoading}
    >
      {normalizedContent}
    </SafeMessageResponse>
  );
}
