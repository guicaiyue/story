import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// 启动页。
///
/// 首屏给品牌呼吸感（00-research 原则 1「陪伴优先于功能」），
/// 短暂停留后进入首页；不在这里做任何阻塞式初始化，
/// 避免弱网时卡在启动页（07 原则「失败即流失」）。
class LaunchScreen extends StatefulWidget {
  const LaunchScreen({
    required this.onFinished,
    this.delay = const Duration(milliseconds: 1400),
    super.key,
  });

  final VoidCallback onFinished;
  final Duration delay;

  @override
  State<LaunchScreen> createState() => _LaunchScreenState();
}

class _LaunchScreenState extends State<LaunchScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(widget.delay, () {
      if (mounted) widget.onFinished();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Material(
      color: p.bg,
      child: SafeArea(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 108,
                height: 108,
                decoration: BoxDecoration(
                  color: p.accentSoft,
                  borderRadius: BorderRadius.circular(StoryTokens.rXl),
                  border: Border.all(color: p.line),
                ),
                child: Icon(Icons.auto_stories_rounded, size: 54, color: p.accentInk),
              ),
              const SizedBox(height: StoryTokens.s6),
              Text(
                '小故事铺',
                style: TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w700,
                  color: p.ink,
                  letterSpacing: 2,
                ),
              ),
              const SizedBox(height: StoryTokens.s2),
              Text(
                '给中国家庭的睡前 20 分钟',
                style: TextStyle(fontSize: 14, color: p.ink2),
              ),
              const SizedBox(height: StoryTokens.s7),
              SizedBox(
                width: 120,
                child: LinearProgressIndicator(
                  minHeight: 3,
                  backgroundColor: p.track,
                  valueColor: AlwaysStoppedAnimation(p.accent),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
