import sharp from "sharp";
import { getConfig } from "./config.js";

const PADDING_X = 16;
const PADDING_Y = 12;
const MIN_WIDTH = 800;
const BG_COLOR = "#1e1e2e";
const FG_COLOR = "#cdd6f4";
const BORDER_RADIUS = 8;
const SCALE = 2; // 2x 渲染倍率，解决高 DPI 屏幕模糊问题

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 计算字符串的显示宽度（CJK 字符占 2 个字符宽度）
 */
function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs / CJK compatibility / Fullwidth forms / etc.
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export async function renderTerminalImage(text: string): Promise<Buffer> {
  const { family: FONT_FAMILY, size: FONT_SIZE, lineHeight: LINE_HEIGHT, charWidth: CHAR_WIDTH } = getConfig().font;
  const lines = text.split("\n");
  const maxDisplayWidth = Math.max(...lines.map(displayWidth), 1);

  const contentWidth = Math.max(maxDisplayWidth * CHAR_WIDTH, MIN_WIDTH);
  const logicalW = contentWidth + PADDING_X * 2;
  const logicalH = lines.length * LINE_HEIGHT + PADDING_Y * 2;

  // SVG 按 SCALE 倍尺寸绘制，确保高 DPI 设备下清晰
  const svgW = logicalW * SCALE;
  const svgH = logicalH * SCALE;
  const s = SCALE; // 缩写

  const tspans = lines
    .map((line, i) => {
      const y = (PADDING_Y + FONT_SIZE + i * LINE_HEIGHT) * s;
      return `<tspan x="${PADDING_X * s}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("\n    ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">
  <rect width="${svgW}" height="${svgH}" rx="${BORDER_RADIUS * s}" ry="${BORDER_RADIUS * s}" fill="${BG_COLOR}"/>
  <text fill="${FG_COLOR}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE * s}" xml:space="preserve">
    ${tspans}
  </text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer() as Promise<Buffer>;
}
