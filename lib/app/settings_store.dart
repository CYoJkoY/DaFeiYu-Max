import 'dart:convert';
import 'dart:io';

import 'plugin_registry.dart';
import '../core/settings.dart';
import 'app_paths.dart';

class SettingsStore {
  SettingsStore({File? file}) : file = file ?? AppPaths.settingsFile;

  final File file;

  PetSettings load() {
    try {
      return normalizeSettings(jsonDecode(file.readAsStringSync()), knownPlatforms: platformIds);
    } catch (_) {
      return normalizeSettings(null, knownPlatforms: platformIds);
    }
  }

  Future<void> save(PetSettings settings) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(const JsonEncoder.withIndent('  ').convert(settings.toJson()));
    if (await file.exists()) await file.delete();
    await temporary.rename(file.path);
  }
}