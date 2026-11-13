import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';

/// 家长门（家长验证）。
///
/// 00-research 原则 4：家长门必须存在。退出儿童模式、修改设置、
/// 查看播放报告都要先过门。用两位数加法，学龄前儿童难以心算通过。
///
/// 通过后返回 `true`（`Navigator.pop(true)`），由调用方决定后续动作。
class ParentGateScreen extends StatefulWidget {
  const ParentGateScreen({this.challenge, super.key});

  /// 测试可注入固定题目；生产不传时随机生成。
  final MathChallenge? challenge;

  @override
  State<ParentGateScreen> createState() => _ParentGateScreenState();
}

class _ParentGateScreenState extends State<ParentGateScreen> {
  late final MathChallenge _challenge;
  final _input = StringBuffer();
  String? _error;
  int _attempts = 0;

  @override
  void initState() {
    super.initState();
    _challenge = widget.challenge ?? MathChallenge.generate();
  }

  void _tap(String digit) {
    if (_input.length >= 4) return;
    setState(() {
      _input.write(digit);
      _error = null;
    });
  }

  void _backspace() {
    if (_input.isEmpty) return;
    setState(() {
      final s = _input.toString();
      _input
        ..clear()
        ..write(s.substring(0, s.length - 1));
      _error = null;
    });
  }

  void _submit() {
    final value = _input.toString();
    if (_challenge.verify(value)) {
      context.read<AppState>().unlockParent();
      Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _attempts++;
      _error = _attempts >= 3 ? '答案不对哦，请让家长再试一次' : '答案不对，再算一次';
      _input.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return StoryScaffold(
      title: '家长验证',
      showBack: true,
      padded: false,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: StoryTokens.s5),
        child: Column(
          children: [
            const SizedBox(height: StoryTokens.s4),
            Icon(Icons.shield_outlined, size: 40, color: p.accentInk),
            const SizedBox(height: StoryTokens.s3),
            Text(
              '请家长完成下面的计算',
              style: TextStyle(fontSize: 15, color: p.ink2),
            ),
            const SizedBox(height: StoryTokens.s4),

            // 题目
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: StoryTokens.s5),
              decoration: BoxDecoration(
                color: p.surface2,
                borderRadius: BorderRadius.circular(StoryTokens.rLg),
                border: Border.all(color: p.line),
              ),
              child: Column(
                children: [
                  Text(
                    _challenge.question,
                    key: const Key('gate-question'),
                    style: TextStyle(
                      fontSize: 34,
                      fontWeight: FontWeight.w700,
                      color: p.ink,
                    ),
                  ),
                  const SizedBox(height: StoryTokens.s3),
                  // 输入显示
                  Container(
                    width: 120,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: p.surf,
                      borderRadius: BorderRadius.circular(StoryTokens.rSm),
                      border: Border.all(color: p.line),
                    ),
                    child: Text(
                      _input.isEmpty ? '?' : _input.toString(),
                      key: const Key('gate-input'),
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        color: _input.isEmpty ? p.ink3 : p.ink,
                      ),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: StoryTokens.s3),
                    Text(
                      _error!,
                      key: const Key('gate-error'),
                      style: TextStyle(fontSize: 13, color: p.danger),
                    ),
                  ],
                ],
              ),
            ),

            const SizedBox(height: StoryTokens.s5),

            // 大键盘（触控 ≥64，符合设计稿 touch-kid）
            Expanded(
              child: _Keypad(
                key: const Key('gate-keypad'),
                onDigit: _tap,
                onBackspace: _backspace,
                onClear: () => setState(() {
                  _input.clear();
                  _error = null;
                }),
              ),
            ),

            PrimaryButton(
              label: '确认',
              onPressed: _input.isEmpty ? null : _submit,
            ),
            const SizedBox(height: StoryTokens.s4),
          ],
        ),
      ),
    );
  }
}

/// 3×4 数字键盘，每格 ≥64。
class _Keypad extends StatelessWidget {
  const _Keypad({
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    super.key,
  });

  final void Function(String) onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final rows = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['C', '0', '⌫'],
    ];

    return Column(
      children: [
        for (final row in rows)
          Expanded(
            child: Row(
              children: [
                for (final key in row)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(StoryTokens.s1),
                      child: Material(
                        color: key == 'C' || key == '⌫' ? p.surface2 : p.surf,
                        borderRadius: BorderRadius.circular(StoryTokens.rMd),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(StoryTokens.rMd),
                          onTap: () {
                            if (key == '⌫') {
                              onBackspace();
                            } else if (key == 'C') {
                              onClear();
                            } else {
                              onDigit(key);
                            }
                          },
                          child: Container(
                            constraints: const BoxConstraints(
                              minHeight: StoryTokens.touchKid,
                            ),
                            alignment: Alignment.center,
                            child: Text(
                              key,
                              style: TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.w600,
                                color: p.ink,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
