/**
 * 项目、会话、会话分类共用的颜色标识色板。
 *
 * 同色系只保留两个，且一深一浅（蓝/靛蓝、草绿/嫩绿、正红/酒红），
 * 排列时再用别的色系隔开，相邻两个色块一眼就能分出来。
 */
export const COLOR_PALETTE = [
  "#1677ff", // 宝蓝
  "#13c2c2", // 明青
  "#2f54eb", // 靛蓝
  "#52c41a", // 草绿
  "#fa8c16", // 橙
  "#a0d911", // 嫩绿
  "#f5222d", // 正红
  "#722ed1", // 紫罗兰
  "#a8071a", // 酒红
  "#888888", // 中灰
  "#eb2f96", // 玫红
  "#a0522d", // 棕
];

/** 随机取一个颜色，新建项目时用。 */
export function randomProjectColor(): string {
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}
