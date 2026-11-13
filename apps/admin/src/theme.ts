/**
 * 设计 token —— 对齐 docs/design/admin-web/assets/css/tokens.css
 *
 * 视觉规格来源：设计稿「纸感后台」。暖米白底 + 暖橙主色 + 暖黑文字 + 深青辅助，
 * 圆角 12–16px，阴影为纸张层叠（不做玻璃/霓虹）。
 */

export const tokens = {
  // 纸感底色与墨色
  bg: '#FBF7F0',
  surface: '#FFFDFA',
  surface2: '#F6F1E8',
  surface3: '#F1EADD',
  sidebarBg: '#F5EFE5',
  line: '#E8DFD2',
  lineStrong: '#DBCFBC',
  ink: '#3A3330',
  ink2: '#6F6560',
  ink3: '#7A7168',

  // 品牌与功能色
  brand: '#D98E5A',
  brandHover: '#C87F4C',
  brandSoft: '#F7E7D8',
  brandLine: '#ECCFB6',
  teal: '#3F5B57',
  tealSoft: '#E4EDEA',
  ok: '#3F6B4F',
  okSoft: '#E6F0E7',
  warn: '#8A5D1C',
  warnSoft: '#F8EEDC',
  danger: '#A9493C',
  dangerSoft: '#F8E5E1',
  info: '#4A6B7C',
  infoSoft: '#E5EEF2',

  // 圆角（设计要求 12–16px）
  radiusSm: 10,
  radius: 12,
  radiusLg: 16,

  // 纸张层叠阴影
  shadow1: '0 1px 2px rgba(58,51,48,0.04), 0 2px 8px rgba(58,51,48,0.05)',
  shadow2: '0 10px 30px rgba(58,51,48,0.13)',

  sidebarWidth: 232,
  topbarHeight: 60,
} as const;

/** 图表低饱和配色（tokens.css --c1..--c10） */
export const chartColors = [
  '#C98A63', '#7E9A93', '#A9A28C', '#8C97A6', '#C0A98E',
  '#93A88F', '#B98E8E', '#9AA3B8', '#B5AE9A', '#8FA6A0',
] as const;

/** 故事状态 → 展示文案与色板（02-architecture §3.1） */
export const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
  published: { label: '已上架', color: tokens.ok, bg: tokens.okSoft },
  review: { label: '待审核', color: tokens.warn, bg: tokens.warnSoft },
  draft: { label: '草稿', color: tokens.ink2, bg: tokens.surface3 },
  archived: { label: '已归档', color: tokens.ink3, bg: tokens.surface2 },
};

/** 年龄档（00-research 原则 2：分龄优先于分类） */
export const ageBands = ['3-6', '6-9', '9+'] as const;
export type AgeBand = (typeof ageBands)[number];
