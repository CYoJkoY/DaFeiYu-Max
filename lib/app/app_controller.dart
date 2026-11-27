// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/services.dart' show rootBundle;
import 'package:material_ui/material_ui.dart';
import 'package:nativeapi/nativeapi.dart' as nativeapi;
import 'package:path/path.dart' as p;
import 'package:url_launcher/url_launcher.dart';
import 'package:window_manager/legacy.dart' as wm;

import '../core/animation.dart';
import '../core/catalog.dart';
import '../core/magpie.dart';
import '../core/market.dart';
import '../core/quota_display.dart';
import '../core/settings.dart';
import '../core/types.dart';
import '../core/version.dart';
import '../ui/theme.dart';
import 'app_paths.dart';
import 'market_client.dart';
import 'plugin_registry.dart';
import 'settings_store.dart';
import 'tray_service.dart';
import 'window_service.dart';

/// Single source of truth shared by the pet overlay and the companion panel.
///
/// The Electron build ran two windows with an IPC snapshot; here one window
/// changes [AppMode] and both views read from this controller, so there is no
/// second copy of the settings or the quota that could drift.
class AppController extends ChangeNotifier with wm.WindowListener implements WindowDelegate {
  AppController({SettingsStore? store}) : _store = store ?? SettingsStore();

  final SettingsStore _store;
  final ActivityReader _activityReader = ActivityReader();
  final GlobalKey petCaptureKey = GlobalKey(debugLabel: 'pet');
  final GlobalKey panelCaptureKey = GlobalKey(debugLabel: 'panel');

  @override
  late PetSettings settings;
  late Catalog catalog;
  late AnimationDirector director;
  late PluginRegistry registry;
  late PluginView pluginView;
  late final WindowService window = WindowService(delegate: this);

  /// The plugin marketplace, published as a plain GitHub repository.
  final MarketClient market = MarketClient();
  MarketIndex? marketIndex;
  String? marketError;
  bool marketBusy = false;
  final Map<String, MarketInstall> marketInstalls = <String, MarketInstall>{};

  Activity activity = const Activity(state: 'unknown', label: '正在连接 Magpie…', available: false, activeCount: 0);
  Quota quota = const Quota(ok: false, windows: []);
  Quota? _cachedQuota;
  TrayService? _tray;

  AppMode mode = AppMode.pet;
  bool petVisible = true;
  bool maximized = false;
  bool quotaLoading = true;
  String? notice;
  double? _fitPetHeight;

  Offset? _petPosition;
  Offset? _savedPetPosition;
  String _activitySignature = '';
  int _lastQuotaAt = 0;
  bool _quitting = false;

  Timer? _activityTimer;
  Timer? _quotaTimer;
  Timer? _uiTimer;

  @override
  String get hitTestClip => director.current.isEmpty ? catalog.idle.first : director.current;

  String get activityLabel => activity.label;

  List<QuotaBadge> get quotaBadges => accountPercentages(quota, activity);

  List<QuotaEntry> get quotaRows => quotaEntries(quota, activity);

  Color get accent => parseAccent(pluginView.accent);

  Future<void> initialize() async {
    settings = _store.load();
    final raw = await rootBundle.loadString('assets/catalog.json');
    catalog = parseCatalog(raw);
    director = AnimationDirector(catalog);
    director
      ..paused = settings.paused
      ..active = settings.active;
    registry = PluginRegistry()..loadInstalled();
    pluginView = registry.resolve(settings);
    _loadMarketProvenance();
    director.next();
    _activitySignature = '';
    await refreshActivity();
    await refreshQuota(force: true);
  }

  Future<void> startWindow() async {
    final saved = settings.x != null && settings.y != null ? Offset(settings.x!, settings.y!) : null;
    await window.applyMode(AppMode.pet, petPosition: saved ?? await window.defaultPetPosition());
    final bounds = await wm.windowManager.getBounds();
    _petPosition = bounds.topLeft;
    _startTimers();
    final tray = TrayService(this);
    _tray = tray;
    try {
      await tray.init();
    } catch (_) {
      // A missing tray host must never stop the pet from running.
    }
  }

  void _startTimers() {
    _activityTimer ??= Timer.periodic(const Duration(seconds: 2), (_) => unawaited(refreshActivity()));
    _quotaTimer ??= Timer.periodic(const Duration(seconds: 30), (_) => unawaited(refreshQuota()));
    _uiTimer ??= Timer.periodic(const Duration(seconds: 30), (_) {
      if (mode == AppMode.panel) notifyListeners();
    });
  }

  Future<void> refreshActivity() async {
    final next = await _activityReader.read();
    final previous = activity;
    final changed = next.state != previous.state || next.eventId != previous.eventId;
    activity = next;
    if (changed) {
      final follow = settings.followTasks && !settings.paused && petVisible && mode == AppMode.pet;
      director.update(next, followTasks: follow);
    } else {
      director.activity = next;
    }
    _activitySignature = '${next.state}|${next.eventId}|${next.activeCount}';
    notifyListeners();
  }

  Future<Quota> refreshQuota({bool force = false}) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (!force && now - _lastQuotaAt < 30000) return quota;
    _lastQuotaAt = now;
    final result = await readQuota();
    final next = result.ok ? result : _mergeCachedQuota(_cachedQuota, result);
    if (next.ok) _cachedQuota = next;
    quota = next;
    quotaLoading = false;
    notifyListeners();
    return next;
  }

  Quota _mergeCachedQuota(Quota? previous, Quota fallback) {
    if (previous == null) return fallback;
    final at = previous.observedAt;
    return Quota(
      ok: previous.ok,
      windows: [
        for (final window in previous.windows)
          QuotaWindow(
            accountId: window.accountId,
            key: window.key,
            provider: window.provider,
            icon: window.icon,
            name: window.name,
            plan: window.plan,
            windowName: window.windowName,
            label: window.label,
            used: window.used,
            remaining: window.remaining,
            resetsAt: window.resetsAt,
            readAt: at,
            stale: window.stale,
            cached: true,
          ),
      ],
      accounts: [
        for (final account in previous.accounts)
          QuotaAccount(
            accountId: account.accountId,
            key: account.key,
            provider: account.provider,
            icon: account.icon,
            name: account.name,
            plan: account.plan,
            label: account.label,
            kind: account.kind,
            balance: account.balance,
            readAt: at,
            cached: true,
          ),
      ],
      observedAt: fallback.observedAt,
      cachedAt: at,
      error: fallback.error,
      usage: previous.usage,
    );
  }

  Future<void> changeSetting(String key, Object? value) async {
    var pluginsChanged = false;
    switch (key) {
      case 'active':
      case 'paused':
      case 'locked':
      case 'followTasks':
      case 'showBulbs':
      case 'showQuotas':
        if (value is! bool) return;
        settings = settings.copyWith(
          active: key == 'active' ? value : null,
          paused: key == 'paused' ? value : null,
          locked: key == 'locked' ? value : null,
          followTasks: key == 'followTasks' ? value : null,
          showBulbs: key == 'showBulbs' ? value : null,
          showQuotas: key == 'showQuotas' ? value : null,
        );
      case 'size':
        if (value is! int || !petSizes.contains(value)) return;
        settings = settings.copyWith(size: value);
      case 'hiddenQuotas':
        settings = settings.copyWith(hiddenQuotas: sanitizeHiddenQuotas(value));
      case 'interests':
        settings = settings.copyWith(interests: sanitizeInterests(value));
      case 'appearance':
        final id = value is String ? value.trim() : '';
        if (id.isNotEmpty && !registry.hasAppearance(id)) return;
        settings = settings.copyWith(
          plugins: id.isEmpty
              ? settings.plugins.copyWith(clearAppearance: true)
              : settings.plugins.copyWith(appearance: id),
        );
        pluginsChanged = true;
      case 'pluginEnabled':
        if (value is! Map) return;
        final id = value['id'];
        final enabled = value['enabled'];
        if (id is! String || enabled is! bool || !registry.hasFestival(id)) return;
        settings = settings.copyWith(
          plugins: settings.plugins.copyWith(enabled: {...settings.plugins.enabled, id: enabled}),
        );
        pluginsChanged = true;
      default:
        return;
    }

    window.resetMotion();
    director
      ..paused = settings.paused
      ..active = settings.active;
    if (key == 'size') await window.refreshPetGeometry();
    if (pluginsChanged) pluginView = registry.resolve(settings);
    await _store.save(settings);
    if (mode == AppMode.pet) await _persistPetPosition();
    await _tray?.refresh();
    notifyListeners();
  }

  void playAction(String name) {
    if (!catalog.names.contains(name)) return;
    _showPet();
    director.select(name, manual: true);
    notifyListeners();
    unawaited(_tray?.refresh());
  }

  void nextClip({bool program = true}) {
    final name = program ? director.program() : director.next();
    director.select(name, manual: true, program: true);
    notifyListeners();
  }

  void clipFinished() {
    if (settings.paused || !petVisible) return;
    director.next();
    notifyListeners();
  }

  void playDragClip() {
    director.select('被鼠标拖拽悬空反馈', manual: true);
    notifyListeners();
  }

  void tapPet() {
    if (settings.locked) return;
    final pool = catalog.clicks.where((name) => name != director.current).toList();
    if (pool.isEmpty) return;
    director.select(pool[math.Random().nextInt(pool.length)], manual: true);
    notifyListeners();
  }

  Future<void> togglePause() async {
    await changeSetting('paused', !settings.paused);
  }

  Future<void> openPanel() async {
    if (mode == AppMode.panel) {
      await wm.windowManager.show();
      await wm.windowManager.focus();
      return;
    }
    _savedPetPosition = _petPosition;
    mode = AppMode.panel;
    await window.applyMode(AppMode.panel);
    unawaited(refreshQuota(force: true));
    notifyListeners();
  }

  Future<void> closePanel() async {
    if (mode != AppMode.panel) return;
    mode = AppMode.pet;
    _fitPetHeight = null;
    await window.applyMode(AppMode.pet, petPosition: _savedPetPosition ?? _petPosition);
    final bounds = await wm.windowManager.getBounds();
    _petPosition = bounds.topLeft;
    notifyListeners();
  }

  Future<void> showPet() async {
    _showPet();
    if (mode == AppMode.panel) {
      await closePanel();
    } else {
      await wm.windowManager.show(inactive: true);
    }
    await _tray?.refresh();
    notifyListeners();
  }

  void _showPet() {
    petVisible = true;
  }

  Future<void> hidePet() async {
    petVisible = false;
    if (mode == AppMode.pet) await wm.windowManager.hide();
    await _tray?.refresh();
    notifyListeners();
  }

  Future<void> togglePetVisibility() async {
    if (petVisible) {
      await hidePet();
    } else {
      await showPet();
    }
  }

  Future<void> saveInterests(String text) async {
    final parts = text
        .split(RegExp(r'[,，、\n\r]+'))
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .toList();
    await changeSetting('interests', parts);
  }

  Future<void> toggleMaximize() async {
    if (maximized) {
      await wm.windowManager.unmaximize();
    } else {
      await wm.windowManager.maximize();
    }
  }

  Future<void> minimizePanel() async {
    await wm.windowManager.minimize();
  }

  Future<void> startPanelDrag() async {
    await wm.windowManager.startDragging();
  }

  /// Called by the pet view once it knows how tall the dock actually is. The
  /// window follows the content instead of guessing a fixed height, which is
  /// what the Electron renderer did through `ResizeObserver`.
  Future<void> fitPetWindow(double height) async {
    if (mode != AppMode.pet) return;
    final previous = _fitPetHeight;
    if (previous != null && (previous - height).abs() < 1) return;
    _fitPetHeight = height;
    await window.resizePetHeight(height);
  }

  Future<void> recenter() async {
    window.resetMotion();
    final area = nativeapi.DisplayManager.instance.getPrimary()?.workArea;
    if (area == null) return;
    final size = window.petSize(settings);
    final position = await window.clampPet(Offset(
      area.x + (area.width - size.width) / 2,
      area.y + (area.height - size.height) / 2,
    ));
    _petPosition = position;
    if (mode == AppMode.pet) await wm.windowManager.setBounds(Rect.fromLTWH(position.dx, position.dy, size.width, size.height));
    await _persistPetPosition();
    await showPet();
  }

  Future<void> openMagpie() async {
    final target = _magpieCandidates().where((path) => FileSystemEntity.typeSync(path) != FileSystemEntityType.notFound);
    if (target.isEmpty) {
      _showNotice('未在默认安装目录找到 Magpie，请从开始菜单或应用程序手动打开。');
      return;
    }
    final path = target.first;
    try {
      if (Platform.isWindows) {
        await Process.start(path, const [], mode: ProcessStartMode.detached);
      } else {
        await Process.run('open', [path]);
      }
    } catch (error) {
      _showNotice('无法打开 Magpie：$error');
    }
  }

  List<String> _magpieCandidates() {
    final env = Platform.environment;
    if (Platform.isWindows) {
      final paths = <String>[];
      final local = env['LOCALAPPDATA'];
      if (local != null) {
        paths.add(p.join(local, 'Programs', 'magpie', 'magpie.exe'));
        paths.add(p.join(local, 'magpie', 'magpie.exe'));
      }
      final programFiles = env['ProgramFiles'];
      if (programFiles != null) paths.add(p.join(programFiles, 'magpie', 'magpie.exe'));
      final programFilesX86 = env['ProgramFiles(x86)'];
      if (programFilesX86 != null) paths.add(p.join(programFilesX86, 'magpie', 'magpie.exe'));
      return paths;
    }
    final home = env['HOME'] ?? '';
    return [
      '/Applications/magpie.app',
      if (home.isNotEmpty) p.join(home, 'Applications', 'magpie.app'),
    ];
  }

  Future<void> openRepository() async {
    await launchUrl(Uri.parse(repositoryUrl), mode: LaunchMode.externalApplication);
  }

  /// The marketplace repository doubles as its own storefront page.
  Future<void> openMarketRepository() async {
    await launchUrl(
      Uri.parse('https://github.com/${settings.plugins.market.repo}'),
      mode: LaunchMode.externalApplication,
    );
  }

  void _loadMarketProvenance() {
    try {
      final file = AppPaths.marketProvenanceFile;
      if (!file.existsSync()) return;
      marketInstalls
        ..clear()
        ..addAll(parseMarketProvenance(file.readAsStringSync()));
    } catch (_) {
      // A corrupt provenance file only means the market forgets what it owns.
    }
  }

  Future<String?> _saveMarketProvenance() async {
    try {
      final file = AppPaths.marketProvenanceFile;
      await file.parent.create(recursive: true);
      await file.writeAsString(encodeMarketProvenance(marketInstalls), flush: true);
      return null;
    } catch (error) {
      return '无法写入插件来源记录：$error';
    }
  }

  /// Re-reads `index.json` from the marketplace repository.
  Future<void> refreshMarket() async {
    if (marketBusy) return;
    marketBusy = true;
    marketError = null;
    notifyListeners();
    final result = await market.refresh(settings.plugins.market);
    marketBusy = false;
    if (!result.ok) {
      marketError = result.error;
      notifyListeners();
      return;
    }
    marketIndex = result.index;
    settings = settings.copyWith(
      plugins: settings.plugins.copyWith(
        market: settings.plugins.market.copyWith(lastSync: DateTime.now().millisecondsSinceEpoch),
      ),
    );
    await _store.save(settings);
    notifyListeners();
  }

  /// Downloads, verifies and installs one market entry.
  Future<void> installMarketPlugin(String id) async {
    if (marketBusy) return;
    final entry = marketIndex?.find(id);
    if (entry == null) {
      _showNotice('市场索引里没有插件 $id，请先刷新市场。');
      return;
    }
    marketBusy = true;
    notifyListeners();
    final result = await market.install(
      settings: settings.plugins.market,
      entry: entry,
      directory: AppPaths.pluginsDirectory,
    );
    marketBusy = false;
    final install = result.install;
    if (install == null) {
      _showNotice(result.error ?? '安装失败');
      return;
    }
    marketInstalls[id] = install;
    final provenanceError = await _saveMarketProvenance();
    registry.reload();
    pluginView = registry.resolve(settings);
    notifyListeners();
    _showNotice(
      provenanceError ??
          '已安装 ${entry.displayName} v${entry.version}。本版尚未接入脚本运行时，插件文件不会被加载或执行。',
    );
  }

  /// Removes one plugin directory that this app installed from the market.
  Future<void> uninstallMarketPlugin(String id) async {
    if (marketBusy) return;
    marketBusy = true;
    notifyListeners();
    final error = await market.uninstall(id: id, directory: AppPaths.pluginsDirectory);
    marketBusy = false;
    if (error != null) {
      _showNotice(error);
      return;
    }
    marketInstalls.remove(id);
    final provenanceError = await _saveMarketProvenance();
    registry.reload();
    pluginView = registry.resolve(settings);
    notifyListeners();
    _showNotice(provenanceError ?? '已卸载插件 $id。');
  }

  void _showNotice(String message) {
    notice = message;
    notifyListeners();
  }

  void dismissNotice() {
    notice = null;
    notifyListeners();
  }

  Future<void> openTrayMenu() async {
    await _tray?.popUp();
  }

  Future<void> startDrag() async {
    await window.startDrag();
  }

  Future<void> endDrag() async {
    await window.endDrag();
    await _persistPetPosition();
  }

  Future<void> _persistPetPosition() async {
    if (mode != AppMode.pet) return;
    try {
      final bounds = await wm.windowManager.getBounds();
      _petPosition = bounds.topLeft;
      settings = settings.copyWith(x: bounds.left, y: bounds.top);
      await _store.save(settings);
    } catch (_) {
      // Losing the last position is not worth blocking the interaction.
    }
  }

  @override
  void onMomentumStopped() {
    unawaited(_persistPetPosition());
  }

  @override
  void onWindowClose() {
    if (_quitting) return;
    if (mode == AppMode.panel) {
      unawaited(closePanel());
    } else {
      unawaited(quit());
    }
  }

  @override
  void onWindowMaximize() {
    maximized = true;
    notifyListeners();
  }

  @override
  void onWindowUnmaximize() {
    maximized = false;
    notifyListeners();
  }

  Future<void> quit() async {
    if (_quitting) return;
    _quitting = true;
    _activityTimer?.cancel();
    _quotaTimer?.cancel();
    _uiTimer?.cancel();
    await _tray?.dispose();
    _tray = null;
    await window.dispose();
    await wm.windowManager.destroy();
    exit(0);
  }

  @override
  void dispose() {
    _activityTimer?.cancel();
    _quotaTimer?.cancel();
    _uiTimer?.cancel();
    market.close();
    unawaited(window.dispose());
    super.dispose();
  }

  /// Used by the smoke run to assert the activity pipeline without Magpie.
  String get activitySignature => _activitySignature;

  /// The window size the pet view should lay itself out for.
  Size get petSize => window.petSize(settings);
}

Color parseAccent(String? hex) => parseHexColor(hex);
