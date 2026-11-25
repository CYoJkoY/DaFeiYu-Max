import 'package:material_ui/material_ui.dart' hide Badge;
import 'package:url_launcher/url_launcher.dart';
import '../app/app_controller.dart';
import '../app/plugin_registry.dart';
import '../core/catalog.dart';
import '../core/quota_display.dart';
import '../core/types.dart';
import '../core/version.dart';
import 'controls.dart';
import 'provider_icons.dart';
import 'theme.dart';

/// The companion panel: a hand-drawn caption bar on top of eight cards that
/// mirror the Electron build's copy one-for-one.
class PanelView extends StatefulWidget {
  const PanelView({required this.controller, super.key});

  final AppController controller;

  @override
  State<PanelView> createState() => _PanelViewState();
}

class _PanelViewState extends State<PanelView> {
  late final TextEditingController _interests =
      TextEditingController(text: widget.controller.settings.interests.join('，'));
  late final TextEditingController _search = TextEditingController();
  String _query = '';

  AppController get controller => widget.controller;

  @override
  void dispose() {
    _interests.dispose();
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      key: controller.panelCaptureKey,
      child: ColoredBox(
        color: Palette.panelBg,
        child: Column(
          children: [
            _titleBar(),
            if (controller.notice != null) _notice(),
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _header(),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 26),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _nowCard(),
                          _quotaCard(),
                          _actionsCard(),
                          _companionCard(),
                          _pluginsCard(),
                          _marketCard(),
                          _socialCard(),
                          _interestsCard(),
                          _footer(),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _titleBar() {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onPanStart: (_) => controller.startPanelDrag(),
      onDoubleTap: controller.toggleMaximize,
      child: Container(
        height: 42,
        padding: const EdgeInsets.only(left: 14, right: 6),
        decoration: const BoxDecoration(
          color: Palette.titlebarBg,
          border: Border(bottom: BorderSide(color: Palette.titlebarBorder)),
        ),
        child: Row(
          children: [
            const Text('🐋', style: TextStyle(fontSize: 15, height: 1)),
            const SizedBox(width: 8),
            Expanded(
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: appName,
                      style: uiText(size: 11, weight: FontWeight.w600, color: Palette.titleInk)
                          .copyWith(letterSpacing: 0.2),
                    ),
                    TextSpan(
                      text: ' · 陪伴面板',
                      style: uiText(size: 11, weight: FontWeight.w500, color: Palette.titleSub),
                    ),
                  ],
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            CaptionButton(icon: GlyphKind.minimize, tooltip: '最小化', onTap: controller.minimizePanel),
            const SizedBox(width: 2),
            CaptionButton(
              icon: controller.maximized ? GlyphKind.restore : GlyphKind.maximize,
              tooltip: controller.maximized ? '还原' : '最大化',
              onTap: controller.toggleMaximize,
            ),
            const SizedBox(width: 2),
            CaptionButton(
              icon: GlyphKind.close,
              tooltip: '关闭面板',
              close: true,
              onTap: controller.closePanel,
            ),
          ],
        ),
      ),
    );
  }

  Widget _notice() {
    return Container(
      width: double.infinity,
      color: const Color(0xFFFFF6EC),
      padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              controller.notice!,
              style: uiText(size: 11, color: Palette.errorInk),
            ),
          ),
          PanelButton(label: '知道了', flat: true, onTap: controller.dismissNotice),
        ],
      ),
    );
  }

  Widget _header() {
    return Container(
      padding: const EdgeInsets.fromLTRB(26, 30, 26, 22),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFE4EFFF), Color(0xFFF4F8FF), Color(0xFFEAF7FA)],
          stops: [0, 0.7, 1],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'YOUR LITTLE MAGPIE COMPANION',
            style: uiText(
              size: 9,
              weight: FontWeight.w700,
              color: const Color(0xFF6281A9),
            ).copyWith(letterSpacing: 1.6),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 10, bottom: 8),
            child: Text(
              '$appName 🐋',
              style: uiText(size: 26, weight: FontWeight.w700, height: 1.15)
                  .copyWith(letterSpacing: -1),
            ),
          ),
          Text(
            '认真陪你工作，也认真吃白饭。',
            style: uiText(size: 12, color: const Color(0xFF6B809B)),
          ),
        ],
      ),
    );
  }

  Widget _nowCard() {
    final activity = controller.activity;
    final count = activity.activeCount > 1 ? ' · ${activity.activeCount} 个请求' : '';
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PanelSectionHeader(
            title: '此刻',
            trailing: Badge(activity.available ? '本机 Magpie' : '状态未知'),
          ),
          Text(
            '${activity.label}$count',
            style: uiText(size: 18, weight: FontWeight.w600),
          ),
          const PanelNote(
            '跟随经过本机 Magpie 的模型请求、排队和可见的工具等待状态。请求结束不代表整个任务完成；'
            '无法判断具体文件操作或等待审批。',
          ),
          PanelButton(label: '打开 Magpie ↗', top: 12, onTap: controller.openMagpie),
        ],
      ),
    );
  }

  Widget _quotaCard() {
    final quota = controller.quota;
    final entries = quotaEntries(quota, null);
    final hidden = controller.settings.hiddenQuotas;
    final allVisible = entries.every((entry) => hidden[entry.key] != true);
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PanelSectionHeader(
            title: '口粮余量',
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                PanelButton(
                  label: '刷新',
                  flat: true,
                  onTap: () => controller.refreshQuota(force: true),
                ),
                const SizedBox(width: 10),
                Tooltip(
                  message: allVisible ? '全部显示中，点击全部隐藏' : '点击全部显示在桌宠上',
                  waitDuration: const Duration(milliseconds: 400),
                  child: PanelSwitch(
                    value: allVisible,
                    enabled: entries.isNotEmpty,
                    onChanged: entries.isEmpty
                        ? null
                        : (value) => controller.changeSetting(
                              'hiddenQuotas',
                              value
                                  ? const <String, bool>{}
                                  : <String, bool>{for (final entry in entries) entry.key: true},
                            ),
                  ),
                ),
              ],
            ),
          ),
          if (!quota.ok)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                quota.error ?? '额度暂不可用',
                style: uiText(size: 12, color: Palette.errorInk, height: 1.6),
              ),
            ),
          for (final entry in entries) _quotaRow(entry, hidden),
          PanelNote(_quotaStamp(quota)),
          if (quota.usage != null)
            PanelNote(
              'Magpie 今日：${quota.usage!.calls} 次请求 · ${quota.usage!.errors} 次错误（按 Magpie 统计口径）',
            ),
        ],
      ),
    );
  }

  Widget _quotaRow(QuotaEntry entry, Map<String, bool> hidden) {
    final visible = hidden[entry.key] != true;
    final name = entry.kind == 'balance' ? entry.label : (entry.windowName ?? entry.label);
    return Padding(
      padding: const EdgeInsets.only(top: 13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5FB),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: ProviderIcon(icon: entry.icon, name: entry.label, size: 16),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Tooltip(
                  message: entry.label,
                  waitDuration: const Duration(milliseconds: 400),
                  child: Text(
                    name,
                    maxLines: 2,
                    style: uiText(size: 11, weight: FontWeight.w600, color: const Color(0xFF4D6483), height: 1.35),
                  ),
                ),
              ),
              const SizedBox(width: 7),
              Text(
                entry.text,
                style: uiText(size: 20, weight: FontWeight.w600, color: const Color(0xFF4575B2), height: 1)
                    .copyWith(fontFeatures: tabularFigures),
              ),
              const SizedBox(width: 7),
              PanelSwitch(
                value: visible,
                onChanged: (value) {
                  final next = Map<String, bool>.from(hidden);
                  if (value) {
                    next.remove(entry.key);
                  } else {
                    next[entry.key] = true;
                  }
                  controller.changeSetting('hiddenQuotas', next);
                },
              ),
            ],
          ),
          if (entry.kind == 'subscription') ...[
            QuotaMeter(
              percent: entry.available ? (entry.remaining ?? 0) : 0,
              low: (entry.remaining ?? 100) < 20,
            ),
            Text(
              _resetLine(entry),
              style: uiText(size: 10, color: const Color(0xFF8695AC), height: 1.4),
            ),
          ] else if (entry.readAt != null || entry.cached == true)
            Text(
              '${entry.readAt != null ? '数据 ${_clock(entry.readAt!)}' : '数据时间未知'}'
              '${entry.cached == true ? ' · 本地缓存' : ''}',
              style: uiText(size: 10, color: const Color(0xFF8695AC), height: 1.4),
            ),
        ],
      ),
    );
  }

  String _resetLine(QuotaEntry entry) {
    final reset = entry.resetsAt != null
        ? '重置：${_beijing(entry.resetsAt!)}（北京时间）'
        : '重置时间暂不可用';
    final stamp = entry.readAt != null
        ? ' · 数据 ${_clock(entry.readAt!)}${entry.cached == true ? ' · 本地缓存' : ''}'
        : ' · 数据时间未知';
    return '$reset$stamp';
  }

  String _quotaStamp(Quota quota) {
    final observedAt = quota.observedAt;
    if (observedAt == null) return '正在读取 Magpie 额度…';
    final stale = DateTime.now().millisecondsSinceEpoch - observedAt > 240000;
    final source = quota.ok
        ? (quota.cachedAt != null ? '显示最近成功缓存' : 'Magpie 缓存 · 订阅额度 / API 余额')
        : '查询未成功';
    return '$source · ${_clock(observedAt)}${stale ? ' · 请刷新' : ''}。'
        '每 30 秒同步；右侧开关控制桌面徽章。';
  }

  Widget _actionsCard() {
    final catalog = controller.catalog;
    final matches = searchActions(catalog, _query);
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PanelSectionHeader(
            title: '来点小节目',
            trailing: Badge('${catalog.names.length} 段动画'),
          ),
          Row(
            children: [
              for (final action in const ['放烟花', '凭空生花', '蓝鲸现世'])
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(right: action == '蓝鲸现世' ? 0 : 6),
                    child: PanelButton(
                      label: _featuredLabel(action),
                      onTap: () => controller.playAction(action),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          _searchField(),
          const SizedBox(height: 8),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 155),
            child: SingleChildScrollView(
              child: Wrap(
                spacing: 5,
                runSpacing: 5,
                children: [
                  for (final name in matches)
                    _ActionChip(
                      label: name,
                      onTap: () => controller.playAction(name),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _featuredLabel(String action) => switch (action) {
        '放烟花' => '✦ 放烟花',
        '凭空生花' => '🪄 凭空生花',
        _ => '🐋 蓝鲸现世',
      };

  Widget _searchField() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFF),
        border: Border.all(color: const Color(0xFFDDE6F3)),
        borderRadius: BorderRadius.circular(10),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 11),
      child: TextField(
        controller: _search,
        onChanged: (value) => setState(() => _query = value),
        style: uiText(size: 12, color: const Color(0xFF37516F)),
        cursorColor: controller.accent,
        decoration: InputDecoration(
          isDense: true,
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 9),
          hintText: '找动作：魔术、吃饭、睡觉…',
          hintStyle: uiText(size: 12, color: const Color(0xFF9AA9BE)),
        ),
      ),
    );
  }

  Widget _companionCard() {
    final settings = controller.settings;
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PanelSectionHeader(title: '陪伴方式'),
          PanelToggleRow(
            label: '跟随 Magpie 请求状态',
            value: settings.followTasks,
            onChanged: (value) => controller.changeSetting('followTasks', value),
          ),
          PanelToggleRow(
            label: '空闲时随机玩耍',
            value: settings.active,
            onChanged: (value) => controller.changeSetting('active', value),
          ),
          PanelToggleRow(
            label: '暂停动画',
            value: settings.paused,
            onChanged: (value) => controller.changeSetting('paused', value),
          ),
          PanelToggleRow(
            label: '锁定桌面位置',
            value: settings.locked,
            onChanged: (value) => controller.changeSetting('locked', value),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 13),
            child: Row(
              children: [
                Expanded(child: Text('角色大小', style: uiText(size: 12))),
                PanelSelect<int>(
                  value: settings.size,
                  options: const <(int, String)>[(360, '小'), (460, '中'), (560, '大')],
                  onChanged: (value) => controller.changeSetting('size', value),
                ),
              ],
            ),
          ),
          const PanelNote(
            '可拖到屏幕左右边缘，超出部分的动作会被裁切。快速甩出会弹跳；右键可点播、隐藏或退出。'
            '菜单栏 🐋 →「回到屏幕内」可随时找回。默认不开机启动。',
          ),
        ],
      ),
    );
  }

  Widget _pluginsCard() {
    final view = controller.pluginView;
    final appearances =
        view.entries.where((entry) => entry.manifest.kind == 'appearance').toList();
    final externals = view.entries.where((entry) => entry.manifest.source == 'external').length;
    final rows = view.entries
        .where((entry) => entry.manifest.kind != 'appearance' && entry.manifest.kind != 'script')
        .toList();
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PanelSectionHeader(
            title: '外观与插件',
            trailing: Badge(externals > 0 ? '内置 + $externals 个外部' : '全部内置'),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              children: [
                Expanded(child: Text('外观', style: uiText(size: 12))),
                PanelSelect<String>(
                  value: view.appearanceId,
                  options: [for (final entry in appearances) (entry.manifest.id, entry.manifest.name)],
                  enabled: appearances.length > 1,
                  onChanged: (value) => controller.changeSetting('appearance', value),
                ),
              ],
            ),
          ),
          PanelNote(_festivalNote(view.festival)),
          for (final entry in rows) _pluginRow(entry),
          if (view.issues.isNotEmpty)
            PanelNote('有 ${view.issues.length} 个外部插件未加载：${view.issues.join('；')}', error: true),
          const PanelNote(
            '外部插件是放在应用数据目录 plugins/ 下的声明式 JSON，只扩展已内置的社交适配器、'
            '动作外观或节日装扮；可写入的社交平台仍需在下方逐项启用，并在发送前逐条确认。',
          ),
        ],
      ),
    );
  }

  String _festivalNote(FestivalWindow? festival) {
    if (festival == null) return '今天没有节日装扮。';
    final greeting = festival.greeting.isEmpty ? '' : '：${festival.greeting}';
    final accessories = festival.accessories.isEmpty ? '' : ' ${festival.accessories.join(' ')}';
    return '${festival.greeting.isEmpty && festival.accessories.isEmpty ? '' : ''}'
        '节日装扮进行中$greeting$accessories';
  }

  Widget _pluginRow(PluginEntry entry) {
    final manifest = entry.manifest;
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.only(top: 10),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Palette.hairline, style: BorderStyle.solid)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 4,
                  runSpacing: 4,
                  children: [
                    Text(
                      manifest.name,
                      style: uiText(size: 12, weight: FontWeight.w600, color: const Color(0xFF425D80)),
                    ),
                    Badge(manifest.kind == 'social' ? '社交' : '节日'),
                    if (manifest.source == 'external') const Badge('外部'),
                    if (entry.active)
                      Badge(
                        '生效中',
                        background: Color.alphaBlend(controller.accent.withValues(alpha: 0.16), Colors.white),
                        color: controller.accent,
                      ),
                  ],
                ),
                if (manifest.description.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      '${manifest.description}'
                      '${manifest.requiresTrust ? ' 此插件声明了更高权限，启用写入后仍需逐条确认。' : ''}',
                      style: uiText(size: 11, color: Palette.muted, height: 1.7),
                    ),
                  ),
              ],
            ),
          ),
          if (manifest.kind == 'festival')
            Padding(
              padding: const EdgeInsets.only(left: 10, top: 2),
              child: PanelSwitch(
                value: controller.settings.plugins.enabled[manifest.id] != false,
                onChanged: (value) => controller.changeSetting(
                  'pluginEnabled',
                  <String, Object>{'id': manifest.id, 'enabled': value},
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _marketCard() {
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PanelSectionHeader(title: '插件市场', trailing: Badge('未开放')),
          const PanelNote('脚本插件运行时尚未迁移到 Flutter 版本：本版保留已安装插件的启停与节日装扮，暂不提供插件安装与市场刷新。'),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              PanelButton(label: '刷新市场', flat: true, enabled: false, onTap: null),
            ],
          ),
          const PanelNote('恢复后会继续按 SHA-256 校验清单与模块，通过后才落盘；未签名的脚本插件启用前仍需确认来源。'),
        ],
      ),
    );
  }

  Widget _socialCard() {
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PanelSectionHeader(title: '它最近在关注', trailing: Badge('未启用')),
          const PanelNote('社交摘要尚未迁移到 Flutter 版本；本版只显示本机 Magpie 的请求与额度。'),
          PanelToggleRow(label: '启用社交摘要', value: false, enabled: false, onChanged: null),
          PanelToggleRow(label: '允许生成待确认草稿', value: false, enabled: false, onChanged: null),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              PanelButton(label: '刷新公开动态', flat: true, enabled: false, onTap: null),
            ],
          ),
          const PanelNote('只读取公开内容；抖音与小黑盒需自备本机桥接，发送一律进入草稿，由你逐条确认。'),
        ],
      ),
    );
  }

  Widget _interestsCard() {
    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PanelSectionHeader(title: '兴趣关键词'),
          const PanelNote('用逗号或换行分隔，最多 20 个；社交摘要会围绕它们挑选公开内容。'),
          Container(
            margin: const EdgeInsets.only(top: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFF),
              border: Border.all(color: const Color(0xFFDDE6F3)),
              borderRadius: BorderRadius.circular(10),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
            child: TextField(
              controller: _interests,
              minLines: 3,
              maxLines: 6,
              style: uiText(size: 12, color: const Color(0xFF37516F)),
              cursorColor: controller.accent,
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 6),
                hintText: 'DeepSeek，Magpie，编程',
                hintStyle: uiText(size: 12, color: const Color(0xFF9AA9BE)),
              ),
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              PanelButton(
                label: '保存兴趣',
                top: 10,
                onTap: () => controller.saveInterests(_interests.text),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _footer() {
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Center(
        child: Hoverable(
          builder: (context, hovered, pressed) => GestureDetector(
            onTap: () => launchUrl(Uri.parse(repositoryUrl), mode: LaunchMode.externalApplication),
            child: Text(
              repositoryUrl.replaceFirst('https://', ''),
              style: uiText(size: 10, color: const Color(0xFF4F78B0)).copyWith(
                decoration: hovered ? TextDecoration.underline : TextDecoration.none,
                decorationColor: const Color(0xFF4F78B0),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Hoverable(
      builder: (context, hovered, pressed) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: hovered ? const Color(0xFFE4ECFA) : const Color(0xFFF3F6FB),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Text(label, style: uiText(size: 10, color: const Color(0xFF426799))),
        ),
      ),
    );
  }
}

String _two(int value) => value.toString().padLeft(2, '0');

/// Wall clock for "data read at" lines; local time, like the old renderer.
String _clock(int millis) {
  final time = DateTime.fromMillisecondsSinceEpoch(millis);
  return '${_two(time.hour)}:${_two(time.minute)}:${_two(time.second)}';
}

/// Quota windows reset on provider-side schedules published as UTC+8, so the
/// reset line is pinned to Beijing time regardless of the machine's zone.
String _beijing(int seconds) {
  final time = DateTime.fromMillisecondsSinceEpoch(seconds * 1000, isUtc: true)
      .add(const Duration(hours: 8));
  return '${time.month}/${time.day} ${_two(time.hour)}:${_two(time.minute)}';
}
