import 'dart:async';
import 'dart:io';

import 'app_paths.dart';

/// One loopback listener per user profile. A second launch sends `show` to the
/// first process and exits without touching the window or the tray.
class SingleInstance {
  ServerSocket? _server;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  void Function()? _onShow;

  Future<bool> acquire() async {
    final file = AppPaths.instanceFile;
    await file.parent.create(recursive: true);
    if (await file.exists()) {
      final port = int.tryParse((await file.readAsString()).trim());
      if (port != null && port > 0 && port <= 65535) {
        try {
          final socket = await Socket.connect(
            InternetAddress.loopbackIPv4,
            port,
            timeout: const Duration(milliseconds: 450),
          );
          socket.write('show\n');
          await socket.flush();
          await socket.close();
          return false;
        } catch (_) {
          // The old process is gone; replace the stale port file below.
        }
      }
      try {
        await file.delete();
      } catch (_) {
        // A racing instance may already have replaced it.
      }
    }

    try {
      _server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0, shared: false);
    } on SocketException {
      return false;
    }
    await file.writeAsString('${_server!.port}\n', flush: true);
    _server!.listen(_accept);
    return true;
  }

  void listen(void Function() onShow) {
    _onShow = onShow;
  }

  void _accept(Socket socket) {
    final buffer = StringBuffer();
    late final StreamSubscription<String> subscription;
    subscription = socket
        .cast<List<int>>()
        .transform(const SystemEncoding().decoder)
        .listen(
      (chunk) {
        buffer.write(chunk);
        if (buffer.toString().contains('show') || buffer.length > 16) {
          _onShow?.call();
          unawaited(subscription.cancel());
          socket.destroy();
        }
      },
      onDone: () => socket.destroy(),
      onError: (_) => socket.destroy(),
      cancelOnError: true,
    );
    _subscriptions.add(subscription);
  }

  Future<void> dispose() async {
    _onShow = null;
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    _subscriptions.clear();
    await _server?.close();
    _server = null;
    try {
      final file = AppPaths.instanceFile;
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Nothing useful to recover here.
    }
  }
}
