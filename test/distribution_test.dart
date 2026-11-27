import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

/// 全仓库的语言上限：Dart + Zig + TypeScript，至多这三种。
///
/// Dart 负责 Flutter 界面与全部共享逻辑；需要脱离 Flutter 运行时的原生能力用
/// Zig；工具脚本、桥接示例与构建辅助用 TypeScript。除此之外的语言一律不允许
/// 混进来，`test/distribution_test.dart` 会逐条检查受版本控制的文件。
const Set<String> _allowedCodeExtensions = <String>{'.dart', '.zig', '.ts'};

/// TypeScript 的其他扩展名同样算 TypeScript，但仓库统一只用 `.ts`。
const Set<String> _typeScriptDialects = <String>{'.mts', '.cts', '.tsx'};

/// 除 Dart / Zig / TypeScript 之外的编程语言扩展名。
const Set<String> _bannedExtensions = <String>{
  // JavaScript 家族：源码只写 TypeScript，不提交任何 JS 文件或产物。
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  // Python
  '.py',
  '.pyc',
  '.pyi',
  '.pyw',
  // PowerShell、Shell 与批处理
  '.ps1',
  '.psm1',
  '.psd1',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.bat',
  '.cmd',
  // 系统与托管运行时语言
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.groovy',
  '.cs',
  '.fs',
  '.vb',
  // 其他脚本语言
  '.rb',
  '.php',
  '.lua',
  '.pl',
  '.pm',
  '.jl',
  '.ex',
  '.exs',
  '.erl',
  '.hs',
  '.clj',
  '.nim',
  // C 家族与 Apple 平台语言
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cxx',
  '.hh',
  '.m',
  '.mm',
  '.swift',
};

/// `windows/` 与 `macos/` 是 `flutter create` 生成的最小宿主外壳。
///
/// 它们是唯一允许出现 C++ / Swift 的地方：只做窗口与打包胶水，不承载共享逻辑，
/// 也不允许出现 Dart / Zig / TypeScript 文件。
const List<String> _platformShellPrefixes = <String>['windows/', 'macos/'];

/// 宿主外壳里允许的扩展名，全部来自 `flutter create` 与图标导出。
const Set<String> _platformShellExtensions = <String>{
  '.cc',
  '.cmake',
  '.cpp',
  '.entitlements',
  '.h',
  '.ico',
  '.json',
  '.manifest',
  '.pbxproj',
  '.plist',
  '.png',
  '.rc',
  '.swift',
  '.txt',
  '.xcconfig',
  '.xcscheme',
  '.xcworkspacedata',
  '.xib',
};

/// 平台分支只允许出现在真正需要区分两个桌面的文件里。
const Set<String> _platformAwareFiles = <String>{
  'lib/app/app_controller.dart',
  'lib/app/app_paths.dart',
  'lib/app/tray_service.dart',
};

void main() {
  final root = _repoRoot();
  final tracked = _trackedFiles(root);

  test('全仓库只用 Dart / Zig / TypeScript 三种语言', () {
    final offenders = <String>[];
    for (final path in tracked) {
      if (_isPlatformShell(path)) continue;
      final extension = _extensionOf(path);
      if (extension == null) continue;
      if (_allowedCodeExtensions.contains(extension)) continue;
      if (_typeScriptDialects.contains(extension)) continue;
      if (!_bannedExtensions.contains(extension)) continue;
      offenders.add(path);
    }
    expect(
      offenders,
      isEmpty,
      reason: '这些文件属于第四种语言，仓库只允许 Dart + Zig + TypeScript：'
          '\n${offenders.join('\n')}',
    );
  });

  test('windows/ 与 macos/ 只放 flutter create 的宿主外壳', () {
    final sharedLogic = <String>[];
    final unexpected = <String>[];
    for (final path in tracked) {
      if (!_isPlatformShell(path)) continue;
      final extension = _extensionOf(path);
      if (extension == null) continue;
      if (_allowedCodeExtensions.contains(extension) ||
          _typeScriptDialects.contains(extension)) {
        sharedLogic.add(path);
        continue;
      }
      if (!_platformShellExtensions.contains(extension)) unexpected.add(path);
    }
    expect(
      sharedLogic,
      isEmpty,
      reason: '宿主外壳里不允许出现 Dart / Zig / TypeScript，共享逻辑只能放 lib/：'
          '\n${sharedLogic.join('\n')}',
    );
    expect(
      unexpected,
      isEmpty,
      reason: '宿主外壳里出现了未知类型的文件：\n${unexpected.join('\n')}',
    );
  });

  test('文档写明 Dart / Zig / TypeScript 三种语言的上限', () {
    final agents = File('${root.path}/AGENTS.md').readAsStringSync();
    for (final language in <String>['Dart', 'Zig', 'TypeScript']) {
      expect(agents, contains(language), reason: 'AGENTS.md 必须写明允许的语言：$language');
    }

    final readme = File('${root.path}/README.md').readAsStringSync();
    for (final language in <String>['Dart', 'Zig', 'TypeScript']) {
      expect(readme, contains(language), reason: 'README.md 必须写明语言上限：$language');
    }

    final decision = File('${root.path}/docs/decisions/languages.md');
    expect(decision.existsSync(), isTrue, reason: '缺少 docs/decisions/languages.md 语言决策记录');
    final text = decision.readAsStringSync();
    for (final language in <String>['Dart', 'Zig', 'TypeScript']) {
      expect(text, contains(language), reason: '语言决策记录必须写明：$language');
    }
  });

  test('CI 的工具链与仓库里的语言保持一致', () {
    final hasZig = tracked.any((path) => path.endsWith('.zig'));
    final hasTypeScript = tracked.any((path) => path.endsWith('.ts'));

    for (final name in <String>['test.yml', 'release.yml']) {
      final workflow = File(
        '${root.path}/.github/workflows/$name',
      ).readAsStringSync();
      expect(workflow, contains('subosito/flutter-action'));
      expect(workflow, contains('flutter test'));
      expect(
        workflow.contains('setup-zig'),
        hasZig,
        reason: '$name 的 Zig 步骤必须与仓库里的 .zig 文件一致',
      );
      expect(
        workflow.contains('setup-node'),
        hasTypeScript,
        reason: '$name 的 Node 步骤必须与仓库里的 .ts 文件一致',
      );
      for (final retired in <String>[
        'npm ci',
        'npm run',
        'npx ',
        'cargo build',
        'pip install',
        'dotnet build',
      ]) {
        expect(workflow, isNot(contains(retired)), reason: '$name 仍在调用 $retired');
      }
    }
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
    final pattern = RegExp(
      r'Platform\.is(Windows|MacOS|Linux)|defaultTargetPlatform',
    );
    for (final file in _walk(Directory(p.join(root.path, 'lib')))) {
      final relative = _relative(root, file);
      if (!relative.endsWith('.dart')) continue;
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

  test('keeps both platform shells on the shared icon master', () {
    expect(
      File('${root.path}/assets/app-icon.png').existsSync(),
      isTrue,
      reason: '图标母版 assets/app-icon.png 缺失',
    );

    final masterIco = File('${root.path}/assets/app-icon.ico');
    final windowsIcon = File(
      '${root.path}/windows/runner/resources/app_icon.ico',
    );
    expect(windowsIcon.existsSync(), isTrue, reason: 'Windows 外壳图标缺失');
    expect(
      windowsIcon.readAsBytesSync(),
      masterIco.readAsBytesSync(),
      reason: 'windows/runner/resources/app_icon.ico 必须与 assets/app-icon.ico 一致',
    );

    final appIconSet = Directory(
      '${root.path}/macos/Runner/Assets.xcassets/AppIcon.appiconset',
    );
    for (final size in <int>[16, 32, 64, 128, 256, 512, 1024]) {
      expect(
        File('${appIconSet.path}/app_icon_$size.png').existsSync(),
        isTrue,
        reason: 'macOS 图标缺少 $size 像素版本',
      );
    }

    final pubspec = File('${root.path}/pubspec.yaml').readAsStringSync();
    expect(pubspec, contains('assets/tray-icon.png'), reason: '托盘图标必须随应用打包');
    expect(
      File('${root.path}/lib/app/tray_service.dart').readAsStringSync(),
      contains("'assets/tray-icon.png'"),
      reason: '托盘服务必须加载随应用打包的 32 像素图标',
    );
  });
}

bool _isPlatformShell(String path) =>
    _platformShellPrefixes.any((prefix) => path.startsWith(prefix));

/// 扩展名一律小写；以点开头的隐藏文件没有扩展名。
String? _extensionOf(String path) {
  final name = path.split('/').last;
  final dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return name.substring(dot).toLowerCase();
}

/// 受版本控制的文件才是仓库的语言契约；本地缓存与构建产物不在其列。
///
/// 仓库是 Git 仓库时用 `git ls-files`，否则退回目录扫描，保证测试在没有 Git
/// 的中间环境里也能跑。
List<String> _trackedFiles(Directory root) {
  try {
    final result = Process.runSync(
      'git',
      <String>['ls-files', '-z'],
      workingDirectory: root.path,
      stdoutEncoding: utf8,
    );
    if (result.exitCode == 0) {
      final output = result.stdout as String;
      final paths = <String>[
        for (final entry in output.split('\u0000'))
          if (entry.isNotEmpty) entry.replaceAll('\\', '/'),
      ];
      if (paths.isNotEmpty) return paths;
    }
  } on ProcessException {
    // 没有安装 Git：退回目录扫描。
  }
  return <String>[
    for (final file in _walk(root))
      _relative(root, file).replaceAll('\\', '/'),
  ];
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
  'node_modules',
  'qa',
  'zig-out',
};

List<File> _walk(Directory directory) {
  if (!directory.existsSync()) return <File>[];
  final files = <File>[];
  for (final entry in directory.listSync(followLinks: false)) {
    if (entry is Directory) {
      final name = entry.path.split(Platform.pathSeparator).last;
      if (_skippedDirectories.contains(name)) continue;
      files.addAll(_walk(entry));
    } else if (entry is File) {
      files.add(entry);
    }
  }
  return files;
}

/// 一律用 `/` 分隔，这样 Windows 与 macOS 上的比较结果一致。
String _relative(Directory root, File file) =>
    p.relative(file.path, from: root.path).replaceAll('\\', '/');
