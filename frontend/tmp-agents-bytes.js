import { readFileSync } from "node:fs";

const text = readFileSync("../docs/改造进度与后续计划.md", "utf8");
const marker = "智能体目录在";
const index = text.indexOf(marker);
process.stdout.write(text.slice(index, index + 280));
