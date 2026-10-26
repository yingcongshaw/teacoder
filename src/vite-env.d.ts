/// <reference types="vite/client" />

declare module "virtual:help-image-dims" {
  /** README 引用到的本地图片 → 原始像素尺寸，键是应用内的访问路径 */
  const dims: Record<string, [number, number]>;
  export default dims;
}
