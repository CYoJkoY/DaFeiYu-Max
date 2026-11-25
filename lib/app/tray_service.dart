// ignore_for_file: deprecated_member_use

import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:tray_manager/legacy.dart';

import 'app_controller.dart';

const _trayTooltip = '蓝色大肥鱼 · Magpie 伴侣';

/// Owns the tray icon and the one menu both platforms share. Windows shows the
/// PNG; macOS keeps the emoji title, so the platform difference stays here and
/// nowhere else.
class TrayService with TrayListener {
  TrayService(this.controller);

  final AppController controller;
  bool _ready = false;

  Future<void> init() async {
    trayManager.addListener(this);
    if (Platform.isWindows) {
      await trayManager.setIcon('assets/brand/tray-icon.png', iconSize: 32);
    } else {
      await trayManager.setTitle('🐋');
    }
    await trayManager.setToolTip(_trayTooltip);
    _ready = true;
    await refresh();
  }

  Future<void> refresh() async {
    if (!_ready) return;
    try {
      await trayManager.setContextMenu(_buildMenu());
    } catch (error) {
      debugPrint('[tray] $error');
    }
  }

  Future<void> popUp() async {
    if (!_ready) return;
    await trayManager.popUpContextMenu();
  }

  Menu _buildMenu() {
    final settings = controller.settings;
    return Menu(items: [
      MenuItem(label: _trayTooltip, disabled: true),
      MenuItem(label: controller.activityLabel, disabled: true),
      MenuItem.separator(),
      MenuItem.submenu(
        label: '点播全部动作',
        submenu: Menu(items: [
          for (final category in controller.catalog.categories)
            MenuItem.submenu(
              label: category.id,
              submenu: Menu(items: [
                for (final name in category.actions)
                  MenuItem(label: name, onClick: (_) => controller.playAction(name)),
              ]),
            ),
        ]),
      ),
      MenuItem.separator(),
      MenuItem(label: '额度与设置…', onClick: (_) => controller.openPanel()),
      MenuItem(label: '打开 Magpie', onClick: (_) => controller.openMagpie()),
      _toggle('跟随 Magpie 请求', 'followTasks', settings.followTasks),
      _toggle('显示请求灯泡', 'showBulbs', settings.showBulbs),
      _toggle('显示账号额度', 'showQuotas', settings.showQuotas),
      _toggle('随机玩耍', 'active', settings.active),
      _toggle('暂停动画', 'paused', settings.paused),
      _toggle('锁定位置', 'locked', settings.locked),
      MenuItem(label: '回到屏幕内', onClick: (_) => controller.recenter()),
      MenuItem.submenu(
        label: '大小',
        submenu: Menu(items: [
          for (final (size, label) in [(360, '小'), (460, '中'), (560, '大')])
            MenuItem.checkbox(
              label: label,
              checked: settings.size == size,
              onClick: (_) => controller.changeSetting('size', size),
            ),
        ]),
      ),
      MenuItem(
        label: controller.petVisible ? '隐藏桌宠' : '显示桌宠',
        onClick: (_) => controller.togglePetVisibility(),
      ),
      MenuItem.separator(),
      MenuItem(label: '退出蓝色大肥鱼', onClick: (_) => controller.quit()),
    ]);
  }

  MenuItem _toggle(String label, String key, bool current) => MenuItem.checkbox(
        label: label,
        checked: current,
        onClick: (_) => controller.changeSetting(key, !current),
      );

  @override
  void onTrayIconMouseDown() {
    if (Platform.isWindows) controller.openPanel();
  }

  @override
  void onTrayIconRightMouseDown() {
    controller.openTrayMenu();
  }

  Future<void> dispose() async {
    _ready = false;
    trayManager.removeListener(this);
    try {
      await trayManager.destroy();
    } catch (_) {
      // Already gone with the process; nothing to clean up.
    }
  }
}
