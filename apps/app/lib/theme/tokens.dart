import 'package:flutter/material.dart';

/// 设计令牌 —— 对齐 docs/design/android-app/assets/css/app.css
///
/// 暖米白纸底 + 暖橙主色 + 暖黑正文；夜间为深靛底。
/// 圆角 20–28，儿童端触控目标 ≥64。
class StoryTokens {
  StoryTokens._();

  // —— 日间 ——
  static const bg = Color(0xFFFBF7F0);
  static const surf = Color(0xFFFFFDF9);
  static const surface2 = Color(0xFFF4EBDD);
  static const line = Color(0xFFEADFCE);
  static const track = Color(0xFFE9DECC);
  static const ink = Color(0xFF3A3330);
  static const ink2 = Color(0xFF6E635C);
  static const ink3 = Color(0xFF948780);
  static const accent = Color(0xFFD98E5A);
  /// 暖橙文字版 —— 纸上对比度 ≥ 4.5:1（正文用这个，不用 accent）。
  static const accentInk = Color(0xFF8A4E26);
  static const accentSoft = Color(0xFFF5E3D3);
  static const accentSoft2 = Color(0xFFEED9C4);
  static const deep = Color(0xFF3A3330);
  static const onDeep = Color(0xFFF7F1E8);
  static const danger = Color(0xFFB4432F);

  // —— 夜间 ——
  static const nBg = Color(0xFF1E1B2E);
  static const nSurf = Color(0xFF272341);
  static const nSurface2 = Color(0xFF221F38);
  static const nLine = Color(0xFF3A3556);
  static const nInk = Color(0xFFF5F0E6);
  static const nInk2 = Color(0xFFB9B2C9);
  static const nAccent = Color(0xFFE8A97A);
  static const nAccentSoft = Color(0xFF2E2A48);
  static const nTrack = Color(0xFF3A3556);

  // —— 圆角（设计要求 20–28） ——
  static const rXl = 28.0;
  static const rLg = 22.0;
  static const rMd = 18.0;
  static const rSm = 14.0;

  // —— 触控 ——
  /// 一般控件最小触控尺寸。
  static const touch = 44.0;

  /// 儿童端最小触控尺寸（设计稿 touch-kid）。
  static const touchKid = 64.0;

  // —— 间距 ——
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s5 = 20.0;
  static const s6 = 24.0;
  static const s7 = 32.0;
}

/// 日间/夜间配色集合，供 ThemeData 与组件按需取用。
class StoryPalette {
  const StoryPalette({
    required this.bg,
    required this.surf,
    required this.surface2,
    required this.line,
    required this.track,
    required this.ink,
    required this.ink2,
    required this.ink3,
    required this.accent,
    required this.accentInk,
    required this.accentSoft,
    required this.deep,
    required this.onDeep,
    required this.danger,
    required this.isNight,
  });

  final Color bg;
  final Color surf;
  final Color surface2;
  final Color line;
  final Color track;
  final Color ink;
  final Color ink2;
  final Color ink3;
  final Color accent;
  final Color accentInk;
  final Color accentSoft;
  final Color deep;
  final Color onDeep;
  final Color danger;
  final bool isNight;

  static const day = StoryPalette(
    bg: StoryTokens.bg,
    surf: StoryTokens.surf,
    surface2: StoryTokens.surface2,
    line: StoryTokens.line,
    track: StoryTokens.track,
    ink: StoryTokens.ink,
    ink2: StoryTokens.ink2,
    ink3: StoryTokens.ink3,
    accent: StoryTokens.accent,
    accentInk: StoryTokens.accentInk,
    accentSoft: StoryTokens.accentSoft,
    deep: StoryTokens.deep,
    onDeep: StoryTokens.onDeep,
    danger: StoryTokens.danger,
    isNight: false,
  );

  static const night = StoryPalette(
    bg: StoryTokens.nBg,
    surf: StoryTokens.nSurf,
    surface2: StoryTokens.nSurface2,
    line: StoryTokens.nLine,
    track: StoryTokens.nTrack,
    ink: StoryTokens.nInk,
    ink2: StoryTokens.nInk2,
    ink3: Color(0xFF8B85A0),
    accent: StoryTokens.nAccent,
    accentInk: StoryTokens.nAccent,
    accentSoft: StoryTokens.nAccentSoft,
    deep: Color(0xFF141223),
    onDeep: StoryTokens.nInk,
    danger: Color(0xFFE08A78),
    isNight: true,
  );

  /// 供 InheritedWidget 取用；未包裹时回落到日间。
  static StoryPalette of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<StoryPaletteScope>()?.palette ?? day;
}

/// 把 [StoryPalette] 挂到 widget 树上，页面用 `StoryPalette.of(context)` 取值。
class StoryPaletteScope extends InheritedWidget {
  const StoryPaletteScope({required this.palette, required super.child, super.key});

  final StoryPalette palette;

  @override
  bool updateShouldNotify(StoryPaletteScope oldWidget) => oldWidget.palette != palette;
}
