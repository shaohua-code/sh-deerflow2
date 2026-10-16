import { afterEach, expect, test, rs } from "@rstest/core";

async function captureThreadStreamOptions(
  overrides: Record<string, unknown> = {},
) {
  let capturedOptions: Record<string, unknown> | undefined;
  let capturedHistoryQueryOptions: Record<string, unknown> | undefined;
  let capturedMetadataQueryOptions: Record<string, unknown> | undefined;
  let capturedLoadMore: (() => void) | undefined;
  const fetchNextPage = rs.fn();

  rs.resetModules();
  rs.doMock("react", () => ({
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
      callback,
    useEffect: () => undefined,
    useMemo: <T>(factory: () => T) => factory(),
    useRef: <T>(initialValue: T) => ({ current: initialValue }),
    useState: <T>(initialValue: T | (() => T)) => [
      typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue,
      rs.fn(),
    ],
  }));
  rs.doMock("@/core/auth/AuthProvider", () => ({
    useAuth: () => ({ user: null }),
  }));
  rs.doMock("@tanstack/react-query", () => ({
    useInfiniteQuery: (options: Record<string, unknown>) => {
      capturedHistoryQueryOptions = options;
      return {
        data: { pages: [] },
        error: null,
        fetchNextPage,
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
      };
    },
    useMutation: rs.fn(),
    useQuery: (options: Record<string, unknown>) => {
      capturedMetadataQueryOptions = options;
      return { data: { thread_id: "cached-private-thread" } };
    },
    useQueryClient: () => ({
      invalidateQueries: rs.fn(),
      setQueriesData: rs.fn(),
    }),
  }));
  rs.doMock("@langchain/langgraph-sdk/react", () => ({
    useStream: (options: Record<string, unknown>) => {
      capturedOptions = options;
      return {
        isLoading: false,
        messages: [],
        stop: rs.fn(),
        submit: rs.fn(),
        values: { title: "", messages: [] },
      };
    },
  }));
  rs.doMock("@/core/api", () => ({
    getAPIClient: () => ({}),
  }));
  rs.doMock("@/core/i18n/hooks", () => ({
    useI18n: () => ({
      t: {
        conversation: {
          streamFailed: "The conversation could not be completed.",
        },
        pages: { newChat: "New chat" },
        uploads: { uploadingFiles: "Uploading files" },
      },
    }),
  }));
  rs.doMock("@/core/tasks/context", () => ({
    useSubtaskContext: () => ({
      tasksRef: { current: {} },
      setTasks: rs.fn(),
    }),
    useUpdateSubtask: () => rs.fn(),
  }));

  const { useThreadMetadata, useThreadStream } =
    await import("@/core/threads/hooks");
  function ThreadStreamCapture() {
    const result = useThreadStream({
      context: {
        mode: "flash",
      },
      isMock: true,
      ...overrides,
    } as never);
    capturedLoadMore = result.loadMoreHistory;
    return null;
  }
  ThreadStreamCapture();
  const metadataResult = useThreadMetadata("private-thread", {
    enabled: false,
  });

  return {
    streamOptions: capturedOptions,
    historyQueryOptions: capturedHistoryQueryOptions,
    metadataQueryOptions: capturedMetadataQueryOptions,
    metadataResult,
    loadMore: capturedLoadMore,
    fetchNextPage,
  };
}

afterEach(() => {
  rs.doUnmock("react");
  rs.doUnmock("@/core/auth/AuthProvider");
  rs.doUnmock("@tanstack/react-query");
  rs.doUnmock("@langchain/langgraph-sdk/react");
  rs.doUnmock("@/core/api");
  rs.doUnmock("@/core/i18n/hooks");
  rs.doUnmock("@/core/tasks/context");
  rs.resetModules();
});

test("does not subscribe to unsupported LangGraph events mode", async () => {
  const { streamOptions: options } = await captureThreadStreamOptions();

  expect(options).toBeDefined();
  expect(options).not.toHaveProperty("onLangChainEvent");
  expect(options).toHaveProperty("onUpdateEvent");
  expect(options).toHaveProperty("onCustomEvent");
});

test("disables thread data reads and hides cached data when access is revoked", async () => {
  const {
    streamOptions,
    historyQueryOptions,
    metadataQueryOptions,
    metadataResult,
    loadMore,
    fetchNextPage,
  } = await captureThreadStreamOptions({
    threadId: "private-thread",
    displayThreadId: "private-thread",
    isMock: false,
    enabled: false,
  });

  expect(historyQueryOptions?.enabled).toBe(false);
  expect(streamOptions?.threadId).toBeUndefined();
  expect(metadataQueryOptions?.enabled).toBe(false);
  expect(metadataResult?.data).toBeUndefined();
  loadMore?.();
  expect(fetchNextPage).not.toHaveBeenCalled();
});

test("does not reconnect to an existing run without runs:read", async () => {
  const { streamOptions, historyQueryOptions } =
    await captureThreadStreamOptions({
      threadId: "private-thread",
      displayThreadId: "private-thread",
      isMock: false,
      enabled: true,
      historyPermissionDenied: true,
    });

  expect(historyQueryOptions?.enabled).toBe(false);
  expect(streamOptions?.threadId).toBe("private-thread");
  expect(streamOptions?.reconnectOnMount).toBe(false);
});
