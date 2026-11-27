import 'dart:io';

import 'package:path/path.dart' as p;

class AppPaths {
  const AppPaths._();

  /// Used by the smoke test so a QA run never touches the real settings file.
  static Directory? overrideUserData;

  static Directory get userData {
    final override = overrideUserData;
    if (override != null) return override;
    final home = Platform.environment['USERPROFILE']
        ?? Platform.environment['HOME']
        ?? Directory.systemTemp.path;
    final Directory root;
    if (Platform.isWindows) {
      root = Directory(Platform.environment['APPDATA'] ?? p.join(home, 'AppData', 'Roaming'));
    } else if (Platform.isMacOS) {
      root = Directory(p.join(home, 'Library', 'Application Support'));
    } else {
      root = Directory(p.join(home, '.local', 'share'));
    }
    return Directory(p.join(root.path, 'BlueDaFeiYu-Codex'));
  }

  static Directory get qa {
    final configured = Platform.environment['DAFEIYU_QA_DIR'];
    return Directory(configured?.trim().isNotEmpty == true
        ? configured!.trim()
        : p.join(userData.path, 'qa'));
  }

  static File get settingsFile => File(p.join(userData.path, 'settings.json'));
  static File get instanceFile => File(p.join(userData.path, 'instance.port'));
  static Directory get pluginsDirectory => Directory(p.join(userData.path, 'plugins'));

  /// Records which plugins came from the marketplace, so the app only updates
  /// or removes the ones it installed itself.
  static File get marketProvenanceFile => File(p.join(userData.path, 'plugin-market.json'));
}
