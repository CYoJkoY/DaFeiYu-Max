import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

/// Plays one bundled WebP clip frame by frame.
///
/// The clips are declared with an infinite loop, but the pet wants the same
/// semantic as the old `<video>` element: play the clip once, then tell the
/// owner so it can pick the next one. Frames are decoded lazily through a single
/// codec, so switching clips never keeps two decoders alive.
class AnimatedWebp extends StatefulWidget {
  const AnimatedWebp({
    required this.clip,
    required this.playing,
    super.key,
    this.onFinished,
    this.colorFilter,
  });

  final String clip;
  final bool playing;
  final VoidCallback? onFinished;
  final ColorFilter? colorFilter;

  @override
  State<AnimatedWebp> createState() => _AnimatedWebpState();
}

class _AnimatedWebpState extends State<AnimatedWebp> {
  ui.Codec? _codec;
  ui.Image? _image;
  Timer? _timer;
  int _generation = 0;
  int _frameIndex = 0;
  int _frameCount = 1;
  bool _ended = false;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load(widget.clip));
  }

  @override
  void didUpdateWidget(AnimatedWebp oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.clip != widget.clip) {
      unawaited(_load(widget.clip));
      return;
    }
    if (oldWidget.playing != widget.playing) {
      if (widget.playing) {
        if (_ended) {
          _restart();
        } else {
          _schedule();
        }
      } else {
        _timer?.cancel();
        _timer = null;
      }
    }
  }

  Future<void> _load(String clip) async {
    final generation = ++_generation;
    _timer?.cancel();
    _timer = null;
    _ended = false;
    _frameIndex = 0;
    _loading = true;
    final previous = _codec;
    _codec = null;

    try {
      final bytes = await rootBundle.load('assets/pet/$clip.webp');
      final codec = await ui.instantiateImageCodec(bytes.buffer.asUint8List());
      if (!mounted || generation != _generation) {
        codec.dispose();
        return;
      }
      _codec = codec;
      _frameCount = codec.frameCount <= 0 ? 1 : codec.frameCount;
      final frame = await codec.getNextFrame();
      if (!mounted || generation != _generation) {
        frame.image.dispose();
        return;
      }
      _loading = false;
      _replaceImage(frame.image);
      _frameIndex = 0;
      if (widget.playing) {
        _timer = Timer(_frameDuration(frame.duration), _tick);
      }
    } catch (_) {
      if (!mounted || generation != _generation) return;
      _loading = false;
      _replaceImage(null);
    } finally {
      previous?.dispose();
    }
  }

  void _restart() {
    final codec = _codec;
    if (codec == null) {
      unawaited(_load(widget.clip));
      return;
    }
    codec.resetCodec();
    _frameIndex = 0;
    _ended = false;
    unawaited(_advance());
  }

  void _schedule() {
    if (!widget.playing || _ended || _loading) return;
    _timer?.cancel();
    _timer = null;
    _timer = Timer(_frameDuration(const Duration(milliseconds: 80)), _tick);
  }

  void _tick() {
    _timer = null;
    if (!mounted || !widget.playing) return;
    unawaited(_advance());
  }

  Future<void> _advance() async {
    final codec = _codec;
    if (codec == null || _loading) return;
    final generation = _generation;
    try {
      final frame = await codec.getNextFrame();
      if (!mounted || generation != _generation) {
        frame.image.dispose();
        return;
      }
      _frameIndex += 1;
      _replaceImage(frame.image);
      if (_frameIndex >= _frameCount - 1) {
        _ended = true;
        _timer?.cancel();
        _timer = null;
        widget.onFinished?.call();
        return;
      }
      if (widget.playing) {
        _timer = Timer(_frameDuration(frame.duration), _tick);
      }
    } catch (_) {
      _ended = true;
      _timer?.cancel();
      _timer = null;
    }
  }

  void _replaceImage(ui.Image? image) {
    final previous = _image;
    setState(() => _image = image);
    if (previous != null && previous != image) {
      WidgetsBinding.instance.addPostFrameCallback((_) => previous.dispose());
    }
  }

  static Duration _frameDuration(Duration raw) {
    final milliseconds = raw.inMilliseconds.clamp(16, 500);
    return Duration(milliseconds: milliseconds);
  }

  @override
  void dispose() {
    _generation += 1;
    _timer?.cancel();
    _timer = null;
    _image?.dispose();
    _image = null;
    _codec?.dispose();
    _codec = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final image = _image;
    if (image == null) return const SizedBox.expand();
    final child = RawImage(image: image, fit: BoxFit.contain, filterQuality: FilterQuality.medium);
    final filter = widget.colorFilter;
    return filter == null ? child : ColorFiltered(colorFilter: filter, child: child);
  }
}
