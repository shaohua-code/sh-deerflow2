import {
  BookOpenIcon,
  ChartNoAxesCombinedIcon,
  CodeIcon,
  FileSearchIcon,
  ImageIcon,
  MicIcon,
  PresentationIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import type { Skill } from "@/core/skills/type";

// 中文卡片摘要由产品层维护；Agent 仍使用技能包中的原始 ID 和完整描述。
// 新增公共技能时按需补齐展示项；测试会检查映射中的 ID 仍存在于技能目录。
export const builtinSkillPresentation: Readonly<
  Record<string, { title: string; description: string; icon: LucideIcon }>
> = {
  "deep-research": {
    title: "深度研究",
    description: "围绕复杂问题检索、交叉验证资料，整理成有据可查的研究报告。",
    icon: SearchIcon,
  },
  "data-analysis": {
    title: "数据分析",
    description: "分析表格与结构化数据，发现规律，并用图表清晰呈现结论。",
    icon: ChartNoAxesCombinedIcon,
  },
  "academic-paper-review": {
    title: "学术论文审阅",
    description: "梳理论文的方法、贡献与不足，生成结构化评审和改进建议。",
    icon: BookOpenIcon,
  },
  bootstrap: {
    title: "个性化 Agent",
    description: "通过循序渐进的交流了解你的偏好，并生成专属 AI 助手设定。",
    icon: SparklesIcon,
  },
  "chart-visualization": {
    title: "图表可视化",
    description: "根据数据特征选择合适的图表，并生成可直接使用的图像。",
    icon: ChartNoAxesCombinedIcon,
  },
  "claude-to-deerflow": {
    title: "DeerFlow 助手",
    description:
      "通过 DeerFlow API 发起研究对话、查询能力、管理记忆或上传文件。",
    icon: SearchIcon,
  },
  "code-documentation": {
    title: "代码文档",
    description:
      "为代码、接口和项目整理 README、API 参考、架构说明与开发指南。",
    icon: CodeIcon,
  },
  "consulting-analysis": {
    title: "咨询分析报告",
    description: "完成市场、行业、品牌、财务或竞争研究，并形成结构化分析报告。",
    icon: ChartNoAxesCombinedIcon,
  },
  "ppt-generation": {
    title: "演示文稿",
    description: "将想法与资料组织成完整的演示文稿，让内容更清晰、更易表达。",
    icon: PresentationIcon,
  },
  "frontend-design": {
    title: "前端设计",
    description: "设计并实现网页与交互界面，兼顾视觉表达和实际使用体验。",
    icon: CodeIcon,
  },
  "image-generation": {
    title: "图像创作",
    description: "根据描述生成图片，把构思变成可直接查看和使用的视觉素材。",
    icon: ImageIcon,
  },
  "podcast-generation": {
    title: "播客制作",
    description: "将资料和主题整理成播客内容，完成从脚本到音频的创作。",
    icon: MicIcon,
  },
  "skill-creator": {
    title: "技能创建",
    description: "把你的工作方法整理成可复用技能，帮助 Agent 掌握新的任务。",
    icon: SparklesIcon,
  },
  "skill-reviewer": {
    title: "技能审阅",
    description: "检查技能包的质量与潜在问题，给出可执行的改进建议。",
    icon: ShieldCheckIcon,
  },
  "find-skills": {
    title: "发现技能",
    description: "根据任务需求查找合适的 Agent 技能，并了解如何安装使用。",
    icon: SparklesIcon,
  },
  "github-deep-research": {
    title: "GitHub 项目研究",
    description: "深入分析开源仓库，梳理项目演进、功能结构、数据和关键变化。",
    icon: SearchIcon,
  },
  "music-generation": {
    title: "音乐创作",
    description: "根据风格、氛围和歌词构思创作歌曲、主题音乐或背景配乐。",
    icon: MicIcon,
  },
  "newsletter-generation": {
    title: "简报与资讯整理",
    description: "围绕指定主题研究资料、筛选内容，并整理成邮件或网页简报。",
    icon: FileSearchIcon,
  },
  "systematic-literature-review": {
    title: "系统文献综述",
    description: "系统检索和整理研究文献，梳理主题、证据与尚待解决的问题。",
    icon: FileSearchIcon,
  },
  "surprise-me": {
    title: "灵感惊喜",
    description: "发现并组合可用技能，为你创作意想不到又有趣的成果。",
    icon: SparklesIcon,
  },
  "vercel-deploy": {
    title: "部署到 Vercel",
    description: "为应用创建 Vercel 预览或正式部署，并提供可访问链接。",
    icon: CodeIcon,
  },
  "video-generation": {
    title: "视频创作",
    description: "根据主题与参考素材构思并生成视频内容。",
    icon: ImageIcon,
  },
  "web-design-guidelines": {
    title: "网页设计审查",
    description: "检查网页界面的可访问性、交互细节与常见设计规范。",
    icon: ShieldCheckIcon,
  },
};

export function presentSkill(skill: Skill, locale: string) {
  const presentation =
    skill.category === "public" &&
    Object.hasOwn(builtinSkillPresentation, skill.name)
      ? builtinSkillPresentation[skill.name]
      : undefined;
  return {
    title: locale === "zh-CN" && presentation ? presentation.title : skill.name,
    description:
      locale === "zh-CN" && presentation
        ? presentation.description
        : skill.description,
    icon: presentation?.icon,
  };
}
