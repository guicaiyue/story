import 'package:flutter/widgets.dart';

/// 屏幕宽度分档：手机 / 小平板 / 平板与桌面。
///
/// 目标用户里「妈妈用平板陪孩子听」是主场景之一，所以平板不是放大版手机：
/// 内容要有最大宽度（否则一行字横跨 1280px，读起来极累），导航要从底部挪到侧边
/// （拇指不用跨过整块屏幕）。
enum LayoutClass { compact, medium, expanded }

/// 600 以下视为手机（竖屏手机普遍 ≤430）。
const double kMediumWidth = 600;

/// 900 以上视为平板/桌面（横屏平板 ≥1024）。
const double kExpandedWidth = 900;

LayoutClass layoutClassOf(double width) {
  if (width < kMediumWidth) return LayoutClass.compact;
  if (width < kExpandedWidth) return LayoutClass.medium;
  return LayoutClass.expanded;
}

LayoutClass layoutOf(BuildContext context) =>
    layoutClassOf(MediaQuery.sizeOf(context).width);

/// 内容区最大宽度：手机上不设限（要吃满），平板上收窄到舒适阅读宽度。
double contentMaxWidthOf(LayoutClass layout) => switch (layout) {
      LayoutClass.compact => double.infinity,
      LayoutClass.medium => 720,
      LayoutClass.expanded => 960,
    };

/// 宽屏时用侧边导航，窄屏用底部导航。
bool usesSideNav(LayoutClass layout) => layout == LayoutClass.expanded;

/// 卡片宽度随屏幕变档：手机上紧凑，平板上给到更大的触控面积与标题长度。
double cardWidthOf(
  LayoutClass layout, {
  required double compact,
  double? medium,
  double? expanded,
}) =>
    switch (layout) {
      LayoutClass.compact => compact,
      LayoutClass.medium => medium ?? compact,
      LayoutClass.expanded => expanded ?? medium ?? compact,
    };
