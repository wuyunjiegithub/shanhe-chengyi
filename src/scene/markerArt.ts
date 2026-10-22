/**
 * 地图标记的「美术层」：只负责在 canvas 上画，不碰 three。
 *
 * 拆出来的两个理由：
 * 1. 设置面板要做样式预览——预览和地图上的标记必须是**同一份绘制代码**，
 *    否则很容易出现「预览是小旗子、地图上是别的东西」这种对不上的情况；
 * 2. SceneManager 已经够长，贴图绘制放在这里便于增改样式。
 *
 * 画布统一 128×168，**底边中点即落点**（Sprite 的 center = (0.5, 0)），
 * 所以每种样式都必须画到贴近画布下沿，否则标记会浮在地面之上。
 */

export type MarkerKind = 'visited' | 'favorite';

/** 「去过」标记的样式 */
export type VisitedStyle = 'flag' | 'pin' | 'stamp' | 'footprint';

export interface VisitedStyleMeta {
  id: VisitedStyle;
  label: string;
  note: string;
}

export const VISITED_STYLES: VisitedStyleMeta[] = [
  { id: 'flag', label: '小旗子', note: '插旗宣示「我到了」，旗杆落地' },
  { id: 'pin', label: '图钉', note: '水滴形地图钉，最像纸质地图上的大头针' },
  { id: 'stamp', label: '打卡章', note: '圆形印章带对勾，像护照上的出入境章' },
  { id: 'footprint', label: '脚印', note: '双足印，呼应「足迹」面板的说法' },
];

export const MARKER_W = 128;
export const MARKER_H = 168;
export const MARKER_ASPECT = MARKER_W / MARKER_H;

/**
 * 「去过」标记的目标屏幕高度（px）。
 * 四种样式的视觉重量不同：细长的旗子要更高才够分量，
 * 实心的印章 / 脚印同等高度下视觉面积大得多，需要压低一档看着才一样重。
 */
export const VISITED_SCREEN_PX: Record<VisitedStyle, number> = {
  flag: 48,
  pin: 46,
  stamp: 42,
  footprint: 44,
};

export const FAVORITE_SCREEN_PX = 36;

/** 去过标记的主色（与收藏的玫红明确区分） */
const RED = 0xff4d5e;
/** 收藏标记：爱心 */
const PINK = 0xf43f7e;

const INK = 'rgba(9,14,22,0.58)';

function shade(hex: number, k = 1): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = ch(((hex >> 16) & 255) * k);
  const g = ch(((hex >> 8) & 255) * k);
  const b = ch((hex & 255) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** 深色描边打底：浅色地形上标记也能立住 */
/** 在 128×168 的画布上，按样式画「去过」标记 */
export function paintVisited(
  ctx: CanvasRenderingContext2D,
  style: VisitedStyle,
): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (style === 'pin') return paintPin(ctx);
  if (style === 'stamp') return paintStamp(ctx);
  if (style === 'footprint') return paintFootprint(ctx);
  paintFlag(ctx);
}

/** 小旗子：白杆 + 飘动的红旗面 + 金球杆头 */
function paintFlag(ctx: CanvasRenderingContext2D): void {
  const poleX = 34;
  const topY = 20;
  const botY = MARKER_H - 6;

  // 杆：先描深色底，再压亮色
  ctx.strokeStyle = INK;
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(poleX, botY);
  ctx.lineTo(poleX, topY);
  ctx.stroke();
  ctx.strokeStyle = '#dbe5f3';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(poleX, botY);
  ctx.lineTo(poleX, topY);
  ctx.stroke();

  // 杆头金球
  ctx.fillStyle = '#ffd479';
  ctx.beginPath();
  ctx.arc(poleX, topY - 4, 8.5, 0, Math.PI * 2);
  ctx.fill();

  // 旗面：右侧做一点飘动弧度，不是死板方块
  const flag = () => {
    ctx.beginPath();
    ctx.moveTo(poleX + 3, topY + 1);
    ctx.lineTo(poleX + 84, topY + 12);
    ctx.quadraticCurveTo(poleX + 98, topY + 44, poleX + 84, topY + 76);
    ctx.lineTo(poleX + 3, topY + 64);
    ctx.closePath();
  };
  flag();
  const grad = ctx.createLinearGradient(poleX, topY, poleX + 84, topY + 76);
  grad.addColorStop(0, shade(RED, 1.35));
  grad.addColorStop(1, shade(RED, 0.72));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();
}

/**
 * 图钉：水滴形，尖端精确落在画布下沿中点 —— 针尖就是落点，
 * 比旗子更「贴地」，密集时也不会互相压住。
 */
function paintPin(ctx: CanvasRenderingContext2D): void {
  const cx = MARKER_W / 2;
  const cy = 66;
  const r = 44;
  const tipY = MARKER_H - 5;
  // 两肩的角度（canvas 里 0 = 右、+π/2 = 下）
  const shoulder = 0.92;

  const body = () => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, shoulder, Math.PI - shoulder, true);
    ctx.lineTo(cx, tipY);
    ctx.closePath();
  };

  body();
  const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.6, cy + r);
  grad.addColorStop(0, shade(RED, 1.32));
  grad.addColorStop(1, shade(RED, 0.7));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();

  // 中心孔：地图钉的经典白孔，48px 下靠这个白点认形状
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = '#fff3f5';
  ctx.fill();
  ctx.strokeStyle = 'rgba(9,14,22,0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 左上高光，避免整块红成一坨
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.42, cy - r * 0.5, r * 0.22, r * 0.13, -0.7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
}

/**
 * 打卡章：一枚立在地面上的圆形邮戳。
 * 圆圈本身压到画布底部（底边即落点），锯齿外环 + 对勾，
 * 在小尺寸下靠「红圈 + 白底 + 一个勾」三件套认出形状。
 */
function paintStamp(ctx: CanvasRenderingContext2D): void {
  const cx = MARKER_W / 2;
  // 圆心压到 106、半径 54：圆的下沿正好贴住画布底部（160/168），
  // 上沿到 52 —— 和旗子 / 图钉一样顶满画布，屏幕上看起来才一样重。
  const cy = 106;
  const r = 54;

  // 盘面：奶白底，压住深色地形
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fdf3ee';
  ctx.fill();

  // 外环用虚线做「邮戳锯齿」的暗示
  ctx.save();
  ctx.setLineDash([9, 6]);
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
  ctx.strokeStyle = shade(RED, 0.95);
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();

  // 内环实线
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
  ctx.strokeStyle = shade(RED, 0.82);
  ctx.lineWidth = 5;
  ctx.stroke();

  // 对勾：短臂在下、长臂甩到右上，才不会被看成「禁止」的斜杠
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.46, cy + r * 0.04);
  ctx.lineTo(cx - r * 0.12, cy + r * 0.4);
  ctx.lineTo(cx + r * 0.54, cy - r * 0.46);
  ctx.strokeStyle = shade(RED, 0.9);
  ctx.lineWidth = 13;
  ctx.stroke();

  // 深色描边压在最外圈，保证浅色地面上也有边界
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke();
}

/**
 * 脚印：一只大足印（前掌 + 足弓 + 脚跟 + 五趾，合并成一个剪影）。
 *
 * 这里试错最多：①「一左一右两只脚」—— 屏幕高度只有 44px，摊开后每只只剩十几像素；
 * ②「五个独立趾头各自描边」—— 小尺寸下变成一圈孤立的小圆点；
 * ③「正圆前掌 + 正圆脚跟断开」—— 读成雪人 / 感叹号。
 * 最终形状的关键是**把脚掌拉长**：前掌略扁、足弓处收窄、脚跟小而圆，
 * 全长约等于宽度的两倍，缩到 40px 也还是「脚」而不是「球」。
 * 描边用「放大后再填一遍」的写法，得到一个整体剪影，内部不会出现黑线。
 */
function paintFootprint(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(MARKER_W / 2, 96);
  ctx.scale(1.3, 1.3);
  // 略向前倾，比正着摆更有「踩下去」的感觉
  ctx.rotate(-0.08);

  interface Part {
    x: number;
    y: number;
    rx: number;
    ry: number;
  }
  const parts: Part[] = [
    // 前掌：横向略宽、纵向略扁
    { x: 0, y: -8, rx: 26, ry: 22 },
    // 足弓：窄而短的连接段，让整个脚掌显长
    { x: 0, y: 21, rx: 11, ry: 13 },
    // 脚跟：小而圆
    { x: 0, y: 42, rx: 15, ry: 17 },
  ];
  const toeAngles = [-0.64, -0.34, -0.04, 0.24, 0.5];
  const toeRadii = [11, 10, 9, 7.5, 6];
  for (let i = 0; i < toeAngles.length; i++) {
    const a = toeAngles[i];
    const d = 34;
    parts.push({
      x: Math.sin(a) * d,
      y: -8 - Math.cos(a) * d,
      rx: toeRadii[i],
      ry: toeRadii[i],
    });
  }

  const stamp = (grow: number, fill: string) => {
    ctx.fillStyle = fill;
    for (const p of parts) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx + grow, p.ry + grow, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  // 深色底放大 2.6 个单位 → 合起来就是一圈均匀描边
  stamp(2.6, INK);
  stamp(0, shade(RED, 0.95));

  // 前掌左上一点高光，避免整块红成一坨
  ctx.beginPath();
  ctx.ellipse(-10, -14, 9, 6, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fill();

  ctx.restore();
}

/** 收藏标记：爱心（经典贝塞尔轮廓，上两瓣下尖） */
export function paintFavorite(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const cx = MARKER_W / 2;
  const cy = MARKER_H / 2 + 8;
  const s = 46;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.82);
  ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.28, cx - s * 0.72, cy - s * 1.32, cx, cy - s * 0.42);
  ctx.bezierCurveTo(cx + s * 0.72, cy - s * 1.32, cx + s * 1.5, cy - s * 0.28, cx, cy + s * 0.82);
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
  grad.addColorStop(0, shade(PINK, 1.28));
  grad.addColorStop(1, shade(PINK, 0.82));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(9,14,22,0.55)';
  ctx.lineWidth = 5;
  ctx.stroke();
  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.42, cy - s * 0.5, s * 0.2, s * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

/** 新建一张已经画好的标记画布（SceneManager 与设置面板预览共用） */
export function renderMarkerCanvas(kind: MarkerKind, style: VisitedStyle): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = MARKER_W;
  cv.height = MARKER_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  if (kind === 'visited') paintVisited(ctx, style);
  else paintFavorite(ctx);
  return cv;
}

export function isVisitedStyle(v: unknown): v is VisitedStyle {
  return VISITED_STYLES.some((s) => s.id === v);
}
