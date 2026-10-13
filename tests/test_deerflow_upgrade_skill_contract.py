"""Keep the documented DeerFlow upgrade workflow safe and actionable."""

from __future__ import annotations

from pathlib import Path

import pytest


_SKILL = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "skills"
    / "deerflow-upgrade"
    / "SKILL.md"
)


@pytest.fixture(scope="module")
def skill_text() -> str:
    return _SKILL.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "contract",
    [
        "用户输入 --升级",
        "https://github.com/bytedance/deer-flow",
        "默认跟随最新稳定 Release",
        "自有 Git remote 是 origin",
        "保留所有未提交和未跟踪文件",
        "scripts/compare_upstream_trees.py",
        "不检出文件",
        "没有比本地更新的稳定 Release",
        "禁止 `git merge --allow-unrelated-histories`",
        "fd_0027_repair_run_change_seq",
        "docs/upgrades/YYYY-MM-DD-HHmm-<中文主题>-v版本号.md",
        "不得对服务器执行部署、迁移或回退",
    ],
)
def test_upgrade_skill_keeps_required_safety_and_evidence_contracts(
    skill_text: str, contract: str
) -> None:
    assert contract in skill_text


def test_upgrade_skill_forbids_destructive_worktree_cleanup(skill_text: str) -> None:
    assert "禁止 git reset、clean、stash、强制 checkout、覆盖式复制" in skill_text
    assert "绝不改写 origin" in skill_text


def test_upgrade_skill_records_unverified_steps_as_unverified(
    skill_text: str,
) -> None:
    assert "未执行的步骤标记未执行，不能写成通过" in skill_text
