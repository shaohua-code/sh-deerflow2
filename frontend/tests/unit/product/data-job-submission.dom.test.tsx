import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";

import {
  clearPendingDataJobSubmission,
  readPendingDataJobSubmission,
  savePendingDataJobSubmission,
  type PendingDataJobSubmission,
} from "@/product/data-job-submission";

const submission: PendingDataJobSubmission = {
  kind: "export",
  scope: "threads",
  idempotencyKey: "idem-1",
};

function setStorageItem(
  name: "getItem" | "setItem" | "removeItem",
  body: () => unknown,
) {
  // 整体替换 window.sessionStorage：部分 dom 环境每次访问返回不同实例，
  // 只改实例方法可能作用于错误对象；用 defineProperty 保证模块读到替身。
  const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  const fake = {
    length: 0,
    clear: () => undefined,
    key: () => null,
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    [name]: body as never,
  };
  Object.defineProperty(window, "sessionStorage", {
    value: fake,
    configurable: true,
  });
  return () => {
    if (original) {
      Object.defineProperty(window, "sessionStorage", original);
    } else {
      delete (window as unknown as Record<string, unknown>).sessionStorage;
    }
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("data-job-submission recovery records", () => {
  it("round-trips one submission per user and isolates owners", () => {
    // 不变量⑦：恢复记录按用户隔离，切号后读不到旧账号的标记。
    expect(savePendingDataJobSubmission("user-1", submission)).toBe(true);
    expect(readPendingDataJobSubmission("user-1")).toEqual(submission);
    expect(readPendingDataJobSubmission("user-2")).toBeNull();

    const deletion: PendingDataJobSubmission = {
      kind: "deletion",
      scope: "memory",
      idempotencyKey: "idem-2",
    };
    expect(savePendingDataJobSubmission("user-2", deletion)).toBe(true);
    expect(readPendingDataJobSubmission("user-2")).toEqual(deletion);
    expect(readPendingDataJobSubmission("user-1")).toEqual(submission);
  });

  it("fails closed when the stored record is unreadable or invalid", () => {
    // 损坏 JSON 必须抛错（失败关闭），不能静默丢弃后生成新键重放旧操作。
    window.sessionStorage.setItem(
      "flow-desk.data-job-submission.v1.user-1",
      "{not json",
    );
    expect(() => readPendingDataJobSubmission("user-1")).toThrow();

    // 形状非法（范围越界、多余字段、幂等键字符集不符）同样拒绝恢复。
    const invalidValues = [
      JSON.stringify({
        kind: "export",
        scope: "not-a-scope",
        idempotencyKey: "idem-1",
      }),
      JSON.stringify({
        kind: "deletion",
        scope: "account",
        idempotencyKey: "idem-1",
      }),
      JSON.stringify({
        kind: "export",
        scope: "threads",
        idempotencyKey: "idem-1",
        extra: 1,
      }),
      JSON.stringify({
        kind: "export",
        scope: "threads",
        idempotencyKey: "bad key!",
      }),
      JSON.stringify({
        kind: "reschedule",
        scope: "threads",
        idempotencyKey: "idem-1",
      }),
    ];
    for (const value of invalidValues) {
      window.sessionStorage.setItem(
        "flow-desk.data-job-submission.v1.user-1",
        value,
      );
      expect(() => readPendingDataJobSubmission("user-1")).toThrow();
    }
  });

  it("reports storage failures so the caller refuses to send new writes", () => {
    // 不变量⑧：存储失败时保存必须返回 false，调用方不得发起写请求。
    const restore = setStorageItem("setItem", () => {
      throw new Error("quota exceeded");
    });
    try {
      expect(savePendingDataJobSubmission("user-1", submission)).toBe(false);
    } finally {
      restore();
    }

    const restoreGet = setStorageItem("getItem", () => {
      throw new Error("unavailable");
    });
    try {
      expect(() => readPendingDataJobSubmission("user-1")).toThrow();
    } finally {
      restoreGet();
    }
  });

  it("only clears the record owned by the same idempotency key", () => {
    savePendingDataJobSubmission("user-1", submission);

    // 晚到回调带着旧键不能删掉另一笔恢复请求。
    expect(clearPendingDataJobSubmission("user-1", "other-key")).toBe(false);
    expect(readPendingDataJobSubmission("user-1")).toEqual(submission);

    expect(clearPendingDataJobSubmission("user-1", "idem-1")).toBe(true);
    expect(readPendingDataJobSubmission("user-1")).toBeNull();

    // 记录已不存在时清理视为成功（幂等）。
    expect(clearPendingDataJobSubmission("user-1", "idem-1")).toBe(true);
  });

  it("returns false from clear when storage access fails", () => {
    savePendingDataJobSubmission("user-1", submission);
    const restore = setStorageItem("getItem", () => {
      throw new Error("unavailable");
    });
    try {
      expect(clearPendingDataJobSubmission("user-1", "idem-1")).toBe(false);
      // 存储异常期间记录仍保留，恢复入口不丢。
    } finally {
      restore();
    }
    expect(readPendingDataJobSubmission("user-1")).toEqual(submission);
  });
});
