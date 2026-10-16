"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { hasPermission, PERMISSIONS } from "@/core/auth/permissions";

import {
  cancelProductDataJob,
  createProductDataDeletion,
  createProductDataExport,
  deleteProductSetting,
  fetchProductDataJobs,
  fetchProductSettings,
  saveProductSetting,
  type ProductJsonValue,
} from "./api";

export const PRODUCT_SETTINGS_QUERY_KEY = ["product", "settings"] as const;
export const PRODUCT_DATA_JOBS_QUERY_KEY = ["product", "data-jobs"] as const;

const ACTIVE_DATA_JOB_STATUSES = new Set(["queued", "running", "retry_wait"]);

function productSettingsQueryKey(userId: string | null) {
  // 登录账号必须属于 query key，否则同一浏览器切换账号时会短暂展示前一用户缓存。
  return [...PRODUCT_SETTINGS_QUERY_KEY, userId] as const;
}

/** 查询由后端按当前登录 principal 隔离的产品偏好。 */
export function useProductSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canRead =
    user !== null && hasPermission(user, PERMISSIONS.PREFERENCES_READ);
  const queryKey = useMemo(() => productSettingsQueryKey(userId), [userId]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchProductSettings(signal),
    enabled: userId !== null && canRead,
    staleTime: 60 * 1000,
    retry: false,
  });
  useEffect(() => {
    if (canRead || userId === null) return;
    // 明确撤销读取权限后清掉同账号的旧偏好快照，不能只把界面藏起来。
    queryClient.removeQueries({ queryKey, exact: true });
  }, [canRead, queryClient, queryKey, userId]);
  return { ...query, data: canRead ? query.data : undefined, canRead };
}

/** 写入或删除成功后使查询缓存失效，页面再从服务端读取权威值。 */
export function useSaveProductSetting() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canWrite =
    user !== null && hasPermission(user, PERMISSIONS.PREFERENCES_WRITE);
  const mutation = useMutation<
    void,
    Error,
    { actorUserId: string | null; key: string; value: ProductJsonValue }
  >({
    mutationFn: ({ actorUserId, key, value }) => {
      if (actorUserId === null || !canWrite) {
        throw new Error("Product preference write permission is required.");
      }
      return saveProductSetting(key, value);
    },
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({
        queryKey: productSettingsQueryKey(variables.actorUserId),
      }),
  });
  return { ...mutation, canWrite };
}

export function useDeleteProductSetting() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canWrite =
    user !== null && hasPermission(user, PERMISSIONS.PREFERENCES_WRITE);
  const mutation = useMutation<
    void,
    Error,
    { actorUserId: string | null; key: string }
  >({
    mutationFn: ({ actorUserId, key }) => {
      if (actorUserId === null || !canWrite) {
        throw new Error("Product preference write permission is required.");
      }
      return deleteProductSetting(key);
    },
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({
        queryKey: productSettingsQueryKey(variables.actorUserId),
      }),
  });
  return { ...mutation, canWrite };
}

/**
 * 只轮询仍在处理中的自有数据任务；列表缓存按已认证账号和 offset 分页，
 * 用户切换账号时不会短暂看到上一个账号的历史或导出状态。
 */
export function useProductDataJobs(offset = 0) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  // 任务历史中的范围会随路由授权变化；用权限快照分区，防止撤权后复用旧列表。
  const permissionSnapshot =
    user?.permissions == null
      ? "unresolved"
      : JSON.stringify([...new Set(user.permissions)].sort());
  const queryKey = [
    ...PRODUCT_DATA_JOBS_QUERY_KEY,
    userId,
    permissionSnapshot,
    offset,
  ] as const;

  useEffect(() => {
    if (userId === null) return;
    const staleFilter = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === PRODUCT_DATA_JOBS_QUERY_KEY[0] &&
        query.queryKey[1] === PRODUCT_DATA_JOBS_QUERY_KEY[1] &&
        query.queryKey[2] === userId &&
        query.queryKey[3] !== permissionSnapshot,
    };
    // 旧分页既要停止在途读取，也要从内存缓存移除；Gateway 仍逐任务复核授权。
    void queryClient.cancelQueries(staleFilter);
    queryClient.removeQueries(staleFilter);
  }, [permissionSnapshot, queryClient, userId]);

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchProductDataJobs(20, offset, signal),
    enabled: userId !== null,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) =>
        ACTIVE_DATA_JOB_STATUSES.has(job.status),
      )
        ? 2_000
        : false,
  });
}

function useInvalidateProductDataJobs() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return () =>
    queryClient.invalidateQueries({
      queryKey: [...PRODUCT_DATA_JOBS_QUERY_KEY, user?.id ?? null],
    });
}

export function useCreateProductDataExport() {
  const invalidateJobs = useInvalidateProductDataJobs();
  return useMutation({
    mutationFn: ({
      scope,
      idempotencyKey,
    }: {
      scope: Parameters<typeof createProductDataExport>[0];
      idempotencyKey: string;
    }) => createProductDataExport(scope, idempotencyKey),
    onSettled: invalidateJobs,
  });
}

export function useCreateProductDataDeletion() {
  const invalidateJobs = useInvalidateProductDataJobs();
  return useMutation({
    mutationFn: ({
      scope,
      idempotencyKey,
    }: {
      scope: Parameters<typeof createProductDataDeletion>[0];
      idempotencyKey: string;
    }) => createProductDataDeletion(scope, idempotencyKey),
    onSettled: invalidateJobs,
  });
}

export function useCancelProductDataJob() {
  const invalidateJobs = useInvalidateProductDataJobs();
  return useMutation({
    mutationFn: cancelProductDataJob,
    onSettled: invalidateJobs,
  });
}
