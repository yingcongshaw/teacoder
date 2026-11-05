/** 项目颜色标记的候选色板。 */
export const PROJECT_COLORS = [
  "#3b82f6", "#722ed1", "#1890ff", "#52c41a",
  "#fa8c16", "#eb2f96", "#f5222d", "#888888",
  "#13c2c2", "#faad14", "#2f54eb", "#9254de",
  "#a0d911", "#d46b08",
];

/** 随机取一个颜色，新建项目时用。 */
export function randomProjectColor(): string {
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
}
