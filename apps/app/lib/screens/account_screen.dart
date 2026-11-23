import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';

/// 账号信息（外部端「补充账号信息」）。
///
/// 解决的是一个很具体的问题：App 里没有登录页，每个安装都是一个新游客账号，
/// 换设备/重装之后进度与收藏就再也找不回来。这一页做两件事：
///
/// 1. 改昵称（`PUT /api/me`）；
/// 2. 给当前游客账号绑手机号（`POST /api/me/bind-phone`），换设备用手机号
///    登录就能回到同一个账号。
///
/// 刻意不做的事：游客数据与既有手机号账号的**合并**（03-decisions D6 未定）。
/// 手机号已被占用时只提示「改用手机号登录」，不悄悄合并两边数据。
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key});

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  late final TextEditingController _nickname;
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _code = TextEditingController();

  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _nickname = TextEditingController(text: context.read<AppState>().account?.nickname ?? '');
  }

  @override
  void dispose() {
    _nickname.dispose();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  void _toast(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _saveNickname() async {
    if (_busy) return;
    setState(() => _busy = true);
    final err = await context.read<AppState>().updateNickname(_nickname.text);
    if (!mounted) return;
    setState(() => _busy = false);
    _toast(err ?? '昵称已保存');
  }

  /// 绑手机号与手机号登录共用一套输入。`bind` 决定调哪个接口。
  Future<void> _submitPhone({required bool bind}) async {
    if (_busy) return;
    final phone = _phone.text.trim();
    final code = _code.text.trim();
    if (phone.isEmpty || code.isEmpty) {
      _toast('请填手机号和验证码');
      return;
    }
    setState(() => _busy = true);
    final state = context.read<AppState>();
    final err = bind
        ? await state.bindPhone(phone: phone, code: code)
        : await state.loginWithPhone(phone: phone, code: code);
    if (!mounted) return;
    setState(() => _busy = false);
    if (err != null) {
      _toast(err);
      return;
    }
    _code.clear();
    _nickname.text = state.account?.nickname ?? _nickname.text;
    _toast(bind ? '手机号已绑定' : '已登录');
  }

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final state = context.watch<AppState>();
    final account = state.account;

    return StoryScaffold(
      title: '账号',
      showBack: true,
      padded: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          StoryTokens.s4,
          0,
          StoryTokens.s4,
          StoryTokens.s7,
        ),
        children: [
          PaperCard(
            child: Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: p.surface2,
                  child: Icon(Icons.person_outline, color: p.accentInk),
                ),
                const SizedBox(width: StoryTokens.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        account?.displayName ?? '正在读取…',
                        key: const Key('account-display-name'),
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          color: p.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        account == null
                            ? '账号信息加载中'
                            : account.isGuest
                                ? '游客账号 · 换设备后内容找不回'
                                : '已绑定 ${account.maskedPhone}',
                        style: TextStyle(fontSize: 13, color: p.ink3),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: StoryTokens.s6),
          _SectionTitle('昵称'),
          const SizedBox(height: StoryTokens.s3),
          PaperCard(
            child: Column(
              children: [
                TextField(
                  key: const Key('account-nickname-field'),
                  controller: _nickname,
                  maxLength: 30,
                  decoration: const InputDecoration(
                    hintText: '比如：小明妈妈',
                    counterText: '',
                  ),
                ),
                const SizedBox(height: StoryTokens.s2),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton(
                    key: const Key('account-save-nickname'),
                    onPressed: _busy ? null : _saveNickname,
                    child: const Text('保存昵称'),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: StoryTokens.s6),
          _SectionTitle(account?.isGuest ?? true ? '绑定手机号' : '已绑定手机号'),
          const SizedBox(height: StoryTokens.s3),
          PaperCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  account?.isGuest ?? true
                      ? '绑好之后，换手机或重装 App，用这个手机号登录就能回到同一个账号，'
                          '收藏和「继续听」都还在。'
                      : '这个账号已绑定 ${account?.maskedPhone}。其他设备用同一个手机号登录即可。',
                  style: TextStyle(fontSize: 13, height: 1.6, color: p.ink2),
                ),
                const SizedBox(height: StoryTokens.s4),
                TextField(
                  key: const Key('account-phone-field'),
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  maxLength: 11,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: '手机号',
                    hintText: '11 位手机号',
                    counterText: '',
                  ),
                ),
                const SizedBox(height: StoryTokens.s2),
                TextField(
                  key: const Key('account-code-field'),
                  controller: _code,
                  keyboardType: TextInputType.number,
                  maxLength: 8,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: '验证码',
                    hintText: '当前为开发期固定验证码',
                    counterText: '',
                  ),
                ),
                const SizedBox(height: StoryTokens.s3),
                Row(
                  children: [
                    if (account?.isGuest ?? true)
                      Expanded(
                        child: FilledButton(
                          key: const Key('account-bind-phone'),
                          onPressed: _busy ? null : () => _submitPhone(bind: true),
                          child: const Text('绑定到当前账号'),
                        ),
                      ),
                    if (account?.isGuest ?? true) const SizedBox(width: StoryTokens.s3),
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('account-login-phone'),
                        onPressed: _busy ? null : () => _submitPhone(bind: false),
                        child: const Text('用手机号登录'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: StoryTokens.s5),
          Text(
            '说明：当前短信通道尚未接入，验证码由服务端固定下发（03-decisions D4）。'
            '同手机号已有账号时不会自动合并两份数据。',
            style: TextStyle(fontSize: 12, height: 1.7, color: p.ink3),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Text(
      text,
      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: p.ink),
    );
  }
}

/// 供「我的」页拿当前账号做展示（避免两处各写一遍格式化）。
String accountSubtitle(AccountInfo? account) {
  if (account == null) return '账号信息加载中';
  if (account.isGuest) return '游客 · 未绑定手机号';
  return '已绑定 ${account.maskedPhone}';
}
