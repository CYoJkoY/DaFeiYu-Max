/// Single source of truth for the version string the app reports to Magpie
/// and to the panel footer. `test/core/version_test.dart` keeps it in step
/// with pubspec.yaml so a release bump cannot forget one of them.
library;

const String appVersion = '0.1.9+19';

const String appName = '蓝色大肥鱼';

const String appUserAgent = 'Magpie-DaFeiYu/$appVersion';

const String repositoryUrl = 'https://github.com/wolfvoid/magpie-DaFeiYu';

const String releasesUrl = 'https://github.com/wolfvoid/magpie-DaFeiYu/releases/latest';
