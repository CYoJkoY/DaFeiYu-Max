import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import '../core/market.dart';
import '../core/settings.dart';
import 'app_paths.dart';

const platformIds = <String>['bilibili', 'tieba', 'douyin', 'xiaoheihe'];

class FestivalWindow {
  const FestivalWindow({
    required this.start,
    required this.end,
    required this.greeting,
    required this.accent,
    required this.accessories,
  });
  final String start;
  final String end;
  final String greeting;
  final String accent;
  final List<String> accessories;
}

class PluginManifest {
  const PluginManifest({
    required this.id,
    required this.version,
    required this.kind,
    required this.name,
    required this.description,
    required this.source,
    this.requiresTrust = false,
    this.accent,
    this.festival,
    this.scriptEntry,
    this.scriptPermissions = const <String>[],
  });
  final String id;
  final String version;
  final String kind;
  final String name;
  final String description;
  final String source;
  final bool requiresTrust;
  final String? accent;
  final FestivalWindow? festival;
  /// Module file inside the plugin directory, for `kind == 'script'`.
  final String? scriptEntry;
  /// Permissions the module asks for; the manifest is untrusted until verified.
  final List<String> scriptPermissions;
}

class PluginEntry {
  const PluginEntry({
    required this.manifest,
    required this.active,
    required this.state,
  });
  final PluginManifest manifest;
  final bool active;
  final String state;
}

class PluginView {
  const PluginView({
    required this.entries,
    required this.issues,
    required this.appearanceId,
    required this.accent,
    required this.festival,
  });
  final List<PluginEntry> entries;
  final List<String> issues;
  final String? appearanceId;
  final String accent;
  final FestivalWindow? festival;
}

bool festivalActive(FestivalWindow window, DateTime now) {
  int monthDay(int month, int day) => month * 100 + day;
  final current = monthDay(now.month, now.day);
  final start = int.tryParse(window.start.split('-').join()) ?? -1;
  final end = int.tryParse(window.end.split('-').join()) ?? -1;
  if (start < 0 || end < 0) return false;
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}

class PluginRegistry {
  final List<PluginManifest> _manifests = _builtinPlugins();

  /// Re-reads the plugins directory from scratch, so the panel reflects an
  /// install or an uninstall immediately.
  void reload() {
    _manifests
      ..clear()
      ..addAll(_builtinPlugins());
    _issues.clear();
    loadInstalled();
  }

  void loadInstalled() {
    final directory = AppPaths.pluginsDirectory;
    if (!directory.existsSync()) return;
    for (final child in directory.listSync()) {
      if (child is! Directory) continue;
      final name = child.uri.pathSegments.where((segment) => segment.isNotEmpty).last;
      // A half-written install must never look like a usable plugin.
      if (name.startsWith('.staging-')) continue;
      try {
        final manifest = _manifestFromJson(
          jsonDecode(File('${child.path}${Platform.pathSeparator}plugin.json').readAsStringSync()),
          source: 'external',
        );
        if (manifest == null) {
          _issues.add('插件 $name 的清单不是受支持的类型');
          continue;
        }
        // The directory name is the identity the market installs and removes by,
        // so a manifest that disagrees would be un-installable.
        if (manifest.id != name) {
          _issues.add('插件 $name 的清单 id 是 ${manifest.id}，与目录名不一致');
          continue;
        }
        if (manifest.kind == 'script') {
          final entry = sanitizeMarketPath(manifest.scriptEntry);
          if (entry == null || !File(p.join(child.path, entry)).existsSync()) {
            _issues.add('插件 $name 缺少脚本模块，未加载');
            continue;
          }
        }
        if (!_manifests.any((item) => item.id == manifest.id)) {
          _manifests.add(manifest);
        }
      } catch (error) {
        _issues.add('插件 $name 读取失败：$error');
      }
    }
  }

  final List<String> _issues = [];

  bool hasAppearance(String id) => _manifests.any((item) => item.id == id && item.kind == 'appearance');
  bool hasFestival(String id) => _manifests.any((item) => item.id == id && item.kind == 'festival');

  /// Version of a plugin that is currently present on disk, if any.
  String? installedVersion(String id) {
    for (final manifest in _manifests) {
      if (manifest.id == id && manifest.source != 'builtin') return manifest.version;
    }
    return null;
  }

  bool hasInstalled(String id) => _manifests.any((item) => item.id == id && item.source != 'builtin');

  PluginView resolve(PetSettings settings, {DateTime? now}) {
    final stamp = now ?? DateTime.now();
    final appearanceId = settings.plugins.appearance;
    final selected = _manifests.where((item) => item.kind == 'appearance' && item.id == appearanceId).toList();
    final appearance = selected.firstOrNull ?? _manifests.firstWhere((item) => item.id == 'classic-finish');
    final festival = _manifests
        .where((item) => item.kind == 'festival' && settings.plugins.enabled[item.id] != false)
        .where((item) => item.festival != null && festivalActive(item.festival!, stamp))
        .firstOrNull;
    final entries = <PluginEntry>[];
    for (final manifest in _manifests) {
      final isActive = manifest.id == appearance.id || manifest.id == festival?.id;
      final state = manifest.kind == 'social'
          ? '仅设置'
          : manifest.kind == 'appearance'
              ? (manifest.id == appearance.id ? '生效中' : '可选用')
              : manifest.kind == 'festival'
                  ? (manifest.id == festival?.id ? '生效中' : '可选用')
                  : manifest.kind == 'script'
                      ? '已安装 · 运行时未接入'
                      : '未接入';
      entries.add(PluginEntry(manifest: manifest, active: isActive, state: state));
    }
    final accent = festival?.accent ?? appearance.accent ?? '#2f6fe0';
    return PluginView(
      entries: entries,
      issues: _issues,
      appearanceId: appearance.id,
      accent: accent,
      festival: festival?.festival,
    );
  }
}

PluginManifest? _manifestFromJson(Object? value, {required String source}) {
  if (value is! Map) return null;
  final id = value['id']?.toString() ?? '';
  final kind = value['kind']?.toString() ?? '';
  if (id.isEmpty || !const {'social', 'appearance', 'festival', 'script'}.contains(kind)) return null;
  final appearance = value['appearance'];
  final festival = value['festival'];
  final script = value['script'];
  return PluginManifest(
    id: id,
    version: value['version']?.toString() ?? '0.0.0',
    kind: kind,
    name: value['labels'] is Map ? (value['labels']['zh'] ?? value['name'] ?? id).toString() : id,
    description: value['description']?.toString() ?? '',
    source: source,
    requiresTrust: value['requiresTrust'] == true,
    accent: appearance is Map && appearance['accent'] is String ? appearance['accent'] as String : null,
    festival: festival is Map && festival['window'] is Map ? _festivalFromJson(festival['window']) : null,
    scriptEntry: script is Map && script['entry'] is String ? script['entry'] as String : null,
    scriptPermissions: script is Map && script['permissions'] is List
        ? [for (final item in script['permissions'] as List) item.toString()]
        : const <String>[],
  );
}

FestivalWindow _festivalFromJson(Object? value) {
  if (value is! Map) {
    return const FestivalWindow(start: '01-01', end: '01-01', greeting: '', accent: '#2f6fe0', accessories: []);
  }
  final window = value;
  return FestivalWindow(
    start: window['start']?.toString() ?? '01-01',
    end: window['end']?.toString() ?? '01-01',
    greeting: window['greeting']?.toString() ?? '',
    accent: window['accent']?.toString() ?? '#2f6fe0',
    accessories: window['accessories'] is List
        ? [for (final item in window['accessories'] as List) item.toString()]
        : const [],
  );
}

List<PluginManifest> _builtinPlugins() => [
  const PluginManifest(
    id: 'bilibili-popular',
    version: '1.0.0',
    kind: 'social',
    name: '哔哩哔哩热门',
    description: '读取哔哩哔哩公开热门视频，只读、无需登录。',
    source: 'builtin',
  ),
  const PluginManifest(
    id: 'tieba-forum',
    version: '1.0.0',
    kind: 'social',
    name: '百度贴吧',
    description: '按兴趣关键词读取贴吧公开帖子标题。',
    source: 'builtin',
  ),
  const PluginManifest(
    id: 'douyin-bridge',
    version: '1.0.0',
    kind: 'social',
    name: '抖音（桥接）',
    description: '通过你本机运行的桥接服务读取并可选发送，桌宠不自行登录。',
    source: 'builtin',
    requiresTrust: true,
  ),
  const PluginManifest(
    id: 'xiaoheihe-bridge',
    version: '1.0.0',
    kind: 'social',
    name: '小黑盒（桥接）',
    description: '通过你本机运行的桥接服务读取并可选发送，桌宠不自行登录。',
    source: 'builtin',
    requiresTrust: true,
  ),
  const PluginManifest(
    id: 'classic-finish',
    version: '1.0.0',
    kind: 'appearance',
    name: '經典外觀',
    description: '默认外观：沿用内置动画与蓝色调色板。',
    source: 'builtin',
    accent: '#2f6fe0',
  ),
  PluginManifest(
    id: 'spring-festival',
    version: '1.0.0',
    kind: 'festival',
    name: '春节装扮',
    description: '春节期间让桌宠披上节日的红色调，并说一句新年好。',
    source: 'builtin',
    festival: FestivalWindow(
      start: '01-20',
      end: '02-20',
      greeting: '新春快乐，恭喜发财！',
      accent: '#d5373c',
      accessories: ['🧧', '🏮'],
    ),
  ),
  PluginManifest(
    id: 'mid-autumn',
    version: '1.0.0',
    kind: 'festival',
    name: '中秋装扮',
    description: '中秋前后换成暖金色调，配一块月饼。',
    source: 'builtin',
    festival: FestivalWindow(
      start: '09-10',
      end: '10-10',
      greeting: '中秋快乐，月圆人团圆！',
      accent: '#c98a2b',
      accessories: ['🥮', '🌕'],
    ),
  ),
];

extension IterableFirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    if (iterator.moveNext()) return iterator.current;
    return null;
  }
}
