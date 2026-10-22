/**
 * 给颜色附加透明度。
 *
 * WHY: antd 的文字色是半透明值，最终呈现的对比度由 alpha 决定，
 * 而 antd 的默认档位（0.88/0.65/0.45/0.25）无法通过 theme 配置调整，只能在此处自行计算。
 * 仅支持 #rgb / #rrggbb，其余格式原样返回。
 */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * 把颜色的 HSL 亮度降低 amount 个百分点，返回实色十六进制值。
 *
 * WHY: antd 用它从 colorBgBase 派生整套背景层次（container=0 / layout=4 / border=15），
 * 但这些 n 值写死在 node_modules 里无法通过 theme 配置调整，只能在此复刻后覆盖。
 *
 * 该实现刻意复刻 antd 的一个既有行为：`FastColor.getHue()` 与 `getSaturation()`
 * 取的是 HSV 定义，而 `getLightness()` 取的是 HSL 定义，三者混用后 round-trip 并非无损，
 * 因此 colorBgBase 为彩色时 n=0 也会偏离原色。保持此行为以免与 antd 组件内部派生的
 * 同名 token 产生色差。
 */
export function solidColor(color: string, amount: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    h = Math.round(60 * (r === max
      ? (g - b) / delta + (g < b ? 6 : 0)
      : g === max
        ? (b - r) / delta + 2
        : (r - g) / delta + 4));
  }
  const s = delta === 0 ? 0 : delta / max;
  const l = Math.max(0, (max + min) / 2 / 255 - amount / 100);

  if (s <= 0) {
    const gray = Math.round(l * 255);
    return toHex([gray, gray, gray]);
  }

  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  const m = l - chroma / 2;
  const sector = hp < 1 ? [chroma, x, 0]
    : hp < 2 ? [x, chroma, 0]
      : hp < 3 ? [0, chroma, x]
        : hp < 4 ? [0, x, chroma]
          : hp < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  return toHex(sector.map((v) => Math.round((v + m) * 255)));
}

function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3
    ? hex.split("").map((c) => c + c).join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb: number[]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}