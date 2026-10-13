import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@rstest/core";

import {
  builtinSkillPresentation,
  presentSkill,
} from "@/components/workspace/capabilities/skill-presentation";
import type { Skill } from "@/core/skills/type";

const publicSkillsRoot = join(process.cwd(), "../skills/public");
const publicSkillNames = readdirSync(publicSkillsRoot)
  .map((directory) => {
    const skillPath = join(publicSkillsRoot, directory, "SKILL.md");
    if (!existsSync(skillPath)) return undefined;
    // 技能目录可能为分发目的改名，运行时 ID 以 frontmatter 的 name 为准。
    const metadataName = /^name:\s*(.+)$/m.exec(
      readFileSync(skillPath, "utf8"),
    )?.[1];
    return metadataName?.trim().replace(/^['"]|['"]$/g, "");
  })
  .filter((name): name is string => name != null);

function skill(name: string, category = "public"): Skill {
  return {
    name,
    category,
    description: "Current description from the skill manifest.",
    license: "MIT",
    enabled: true,
    editable: false,
  };
}

describe("skill card presentation", () => {
  it("only defines curated metadata for existing public skills", () => {
    expect(publicSkillNames.length).toBeGreaterThan(0);
    const staleNames = Object.keys(builtinSkillPresentation).filter(
      (name) => !publicSkillNames.includes(name),
    );
    expect(staleNames).toEqual([]);
  });

  it("keeps source names and descriptions for English cards", () => {
    for (const name of publicSkillNames) {
      const source = skill(name);
      expect(presentSkill(source, "en-US")).toMatchObject({
        title: source.name,
        description: source.description,
      });
    }
  });

  it("falls back to source metadata for uncurated public skills", () => {
    for (const name of [...publicSkillNames, "new-public-skill"]) {
      if (Object.hasOwn(builtinSkillPresentation, name)) continue;
      const source = skill(name);
      expect(presentSkill(source, "zh-CN")).toEqual({
        title: source.name,
        description: source.description,
        icon: undefined,
      });
    }
  });

  it.each(["custom", "integrations", "legacy"])(
    "does not shadow a %s skill with the same name as a built-in",
    (category) => {
      const source = skill("deep-research", category);
      expect(presentSkill(source, "zh-CN")).toEqual({
        title: source.name,
        description: source.description,
        icon: undefined,
      });
    },
  );

  it("keeps the full source description available alongside a curated summary", () => {
    const source = Object.freeze(skill("deep-research"));
    const presented = presentSkill(source, "zh-CN");
    expect(presented.title).toBe("深度研究");
    expect(presented.description).not.toBe(source.description);
    expect(source.description).toBe(
      "Current description from the skill manifest.",
    );
  });

  it("localizes public card titles and summaries without changing skill IDs", () => {
    const bootstrap = skill("bootstrap");
    const presentedBootstrap = presentSkill(bootstrap, "zh-CN");
    expect(presentedBootstrap).toMatchObject({
      title: "个性化 Agent",
      description: "通过循序渐进的交流了解你的偏好，并生成专属 AI 助手设定。",
    });
    expect(bootstrap.name).toBe("bootstrap");

    expect(presentSkill(skill("chart-visualization"), "zh-CN")).toMatchObject({
      title: "图表可视化",
      description: "根据数据特征选择合适的图表，并生成可直接使用的图像。",
    });
  });

  it.each(["constructor", "toString", "__proto__"])(
    "uses source metadata for the prototype-like name %s",
    (name) => {
      const source = skill(name);
      expect(presentSkill(source, "zh-CN")).toEqual({
        title: name,
        description: source.description,
        icon: undefined,
      });
    },
  );
});
