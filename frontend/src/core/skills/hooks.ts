import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { enableSkill, SkillRequestError, uploadSkillArchive } from "./api";

import { loadSkills } from ".";

const SKILLS_QUERY_KEY = ["skills"] as const;

/** 调用方必须传入当前用户的 skills:read 权限状态，避免目录查询默认放行。 */
export function useSkills(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (enabled) return;

    // 撤销 skills:read 后立即取消目录请求并清除旧缓存，避免旧快照继续展示。
    void queryClient.cancelQueries({ queryKey: SKILLS_QUERY_KEY, exact: true });
    queryClient.removeQueries({ queryKey: SKILLS_QUERY_KEY, exact: true });
  }, [enabled, queryClient]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: ({ signal }) => loadSkills({ signal }),
    enabled,
    retry: (count, err) => !(err instanceof SkillRequestError) && count < 3,
  });
  return {
    skills: enabled ? (data ?? []) : [],
    hasData: enabled && data !== undefined,
    isLoading: enabled && isLoading,
    isFetching: enabled && isFetching,
    error: enabled ? error : null,
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
      void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
    },
  });
}

export function useUploadSkillArchive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadSkillArchive,
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
      }
    },
  });
}
