import 'package:flutter_test/flutter_test.dart';

import 'package:magpie_dafeiyu/core/version.dart';

void main() {
  test('reports the app version from pubspec.yaml', () {
    expect(appVersion, '0.1.10+20');
  });

  test('builds the magpie user agent and release links', () {
    expect(appUserAgent, 'Magpie-DaFeiYu/0.1.10+20');
    expect(repositoryUrl, 'https://github.com/wolfvoid/magpie-DaFeiYu');
    expect(
      releasesUrl,
      'https://github.com/wolfvoid/magpie-DaFeiYu/releases/latest',
    );
  });
}
