import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Extensions that must never reappear in the hand-written parts of the repo.
///
/// The Flutter rewrite keeps exactly two source languages: Dart and the
/// HTML + CSS pair that Magpie loads directly. Everything else here belongs to
/// the retired Electron / Zig toolchain.
const Set<String> _bannedExtensions = <String>{
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.ps1',
  '.psm1',
  '.sh',
  '.bat',
  '.cmd',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.mm',
  '.go',
  '.java',
  '.cs',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.lua',
  '.pl',
};

/// Directories owned by the Flutter toolchain or by local runs.
///
/// `windows/` and `macos/` hold the small platform shells that `flutter create`
/// generates in C++ and Swift; they are build scaffolding, not shared logic.
const Set<String> _skippedDirectories = <String>{
  '.dart_tool',
  '.git',
  '.idea',
  '.plugin_symlinks',
  '.runtime',
  '.zig-cache',
  'Pods',
  'build',
  'dist',
  'ephemeral',
  'macos',
  'node_modules',
  'qa',
  'windows',
};

/// Platform branches are only welcome where the two desktops genuinely differ.
const Set<String> _platformAwareFiles = <String>{
  'lib/app/app_controller.dart',
  'lib/app/app_paths.dart',
  'lib/app/tray_service.dart',
};

void main() {
  final root = _repoRoot();
  final files = _walk(root);

  test('keeps Dart, HTML and CSS as the only source languages', () {
    final offenders = <String>[];
    for (final file in files) {
      final name = _lastSegment(file.path);
      final dot = name.lastIndexOf('.');
      if (dot <= 0) continue;
      final extension = name.substring(dot).toLowerCase();
      if (!_bannedExtensions.contains(extension)) continue;
      offenders.add(_relative(root, file));
    }
    expect(
      offenders,
      isEmpty,
      reason: '这些文件属于已退役的工具链，Flutter 版本只保留 Dart 与静态 HTML/CSS：'
          '\n${offenders.join('\n')}',
    );
  });

  test('keeps every shipped web asset script-free', () {
    final magpieDir = Directory('${root.path}/magpie');
    expect(magpieDir.existsSync(), isTrue, reason: 'Magpie 页面目录缺失');

    final html = File('${magpieDir.path}/index.html').readAsStringSync();
    expect(html, contains('安装这个插件不会安装、下载或启动它'));
    expect(
      html,
      contains(
        'Installing this plugin does not install, download or start the app',
      ),
    );
    expect(html, contains('dsh-pet'));
    expect(html, contains('non-commercial'));
    expect(html, contains('releases/latest'));
    expect(html, contains('lang="en"'));

    final lowered = html.toLowerCase();
    for (final marker in <String>[
      '<script',
      'onclick=',
      'onload=',
      'onchange=',
      'javascript:',
    ]) {
      expect(lowered, isNot(contains(marker)), reason: 'Magpie 页面不允许脚本：$marker');
    }

    final css = File('${magpieDir.path}/page.css').readAsStringSync();
    expect(css, isNot(contains('javascript:')));
  });

  test('publishes one version in pubspec.yaml and version.dart', () {
    final pubspec = File('${root.path}/pubspec.yaml').readAsStringSync();
    final match = RegExp(
      r'^version:\s*(\S+)\s*$',
      multiLine: true,
    ).firstMatch(pubspec);
    expect(match, isNotNull, reason: 'pubspec.yaml 缺少 version 行');

    final version = match!.group(1)!;
    expect(version, matches(RegExp(r'^0\.1\.\d+\+\d+$')));

    final versionDart = File(
      '${root.path}/lib/core/version.dart',
    ).readAsStringSync();
    expect(versionDart, contains("const String appVersion = '$version';"));
  });

  test('keeps the shared code free of platform branches', () {
    final offenders = <String>[];
    final pattern = RegExp(r'Platform\.is(Windows|MacOS|Linux)|defaultTargetPlatform');
    for (final file in files) {
      final relative = _relative(root, file);
      if (!relative.startsWith('lib/') || !relative.endsWith('.dart')) continue;
      if (_platformAwareFiles.contains(relative)) continue;
      if (pattern.hasMatch(file.readAsStringSync())) offenders.add(relative);
    }
    expect(
      offenders,
      isEmpty,
      reason: '平台差异只允许出现在 ${_platformAwareFiles.join('、')}：'
          '\n${offenders.join('\n')}',
    );
  });

  test('reads Magpie at the same XDG path on both desktops', () {
    final magpie = File('${root.path}/lib/core/magpie.dart').readAsStringSync();
    expect(magpie, contains('XDG_CONFIG_HOME'));
    expect(magpie, contains('.config'));
    expect(magpie, contains('magpie'));
    expect(magpie, contains('settings.json'));
    expect(magpie, contains('MAGPIE_API_KEY'));
    expect(magpie, contains('3425'));
    expect(magpie, isNot(contains('Platform.is')));
  });

  test('builds in CI with Flutter only', () {
    for (final name in <String>['test.yml', 'release.yml']) {
      final text = File(
        '${root.path}/.github/workflows/$name',
      ).readAsStringSync();
      expect(text, contains('subosito/flutter-action'));
      expect(text, contains('flutter test'));
      for (final retired in <String>[
        'setup-node',
        'setup-zig',
        'npm ci',
        'npm run',
      ]) {
        expect(text, isNot(contains(retired)), reason: '$name 仍在调用 $retired');
      }
    }
  });
}

Directory _repoRoot() {
  var directory = Directory.current.absolute;
  while (true) {
    if (File('${directory.path}/pubspec.yaml').existsSync()) return directory;
    final parent = directory.parent;
    if (parent.path == directory.path) {
      fail('从 ${Directory.current.path} 向上找不到 pubspec.yaml');
    }
    directory = parent;
  }
}

List<File> _walk(Directory directory) {
  final files = <File>[];
  for (final entry in directory.listSync(followLinks: false)) {
    if (entry is Directory) {
      final name = _lastSegment(entry.path);
      if (_skippedDirectories.contains(name)) continue;
      files.addAll(_walk(entry));
    } else if (entry is File) {
      files.add(entry);
    }
  }
  return files;
}

String _relative(Directory root, File file) {
  final rootPath = root.path.endsWith(Platform.pathSeparator)
      ? root.path
      : '${root.path}${Platform.pathSeparator}';
  return file.path.startsWith(rootPath)
      ? file.path.substring(rootPath.length)
      : file.path;
}

String _lastSegment(String path) => path.split(Platform.pathSeparator).last;
