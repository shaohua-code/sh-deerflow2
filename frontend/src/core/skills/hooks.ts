import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import { getPermissionState, PERMISSIONS } from "@/core/auth/permissions";

import { enableSkill, SkillRequestError, uploadSkillArchive } from "./api";

import { loadSkills } from ".";

const SKILLS_QUERY_PREFIX = ["skills"] as const;

export function skillsQueryKey(userId: string | null | undefined) {
  // owner 位于 skills 之后；["skills"] 仍能失效全部账号。
  return ["skills", userId ?? null] as const;
}

export function isOwnerSkillsQuery(
  queryKey: readonly unknown[],
  userId: string | null,
) {
  // 第 2 段才是 owner。其它 skills 命名空间不会被当成目录行清掉。
  return queryKey[0] === "skills" && queryKey[1] === userId;
}

/** 目录读取按 skills:read 门控；enabled 缺省时仍请求，除非该权限已被明确拒绝。 */
export function useSkills(enabled?: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // GET /api/skills 要求 skills:read 与 skills:read data scope；权限字段缺失时继续请求。
  const accessDenied =
    getPermissionState(user, PERMISSIONS.SKILLS_READ) === "denied";
  const queryClient = useQueryClient();
  const callerEnabled = (enabled ?? true) && !accessDenied;
  const queryKey = skillsQueryKey(userId);

  useEffect(() => {
    if (!accessDenied) return;
    // 只取消并清理当前账号的技能目录。调用方停用不能清空该账号缓存。
    const ownerQueries = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        isOwnerSkillsQuery(query.queryKey, userId),
    };
    void queryClient.cancelQueries(ownerQueries);
    queryClient.removeQueries(ownerQueries);
  }, [accessDenied, queryClient, userId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadSkills({ signal }),
    // enabled 可能缺省；不能写成 enabled && !accessDenied，否则 undefined 会被 TanStack 当成 true。
    enabled: callerEnabled,
    retry: (count, err) => !(err instanceof SkillRequestError) && count < 3,
  });
  const visible = callerEnabled && !accessDenied;
  return {
    skills: visible ? (data ?? []) : [],
    hasData: visible && data !== undefined,
    isLoading: visible && isLoading,
    isFetching: visible && isFetching,
    error: visible ? error : null,
    refetch,
  };
}

export function useEnableSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      skillName,
      enabled,
    }: {
      skillName: string;
      enabled: boolean;
    }) => {
      await enableSkill(skillName, enabled);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_PREFIX });
    },
  });
}

export function useUploadSkillArchive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadSkillArchive,
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_PREFIX });
      }
    },
  });
}
