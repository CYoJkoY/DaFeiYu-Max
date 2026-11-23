import type { Dimensions, Point, Rect } from './types.ts';

/**
 * Clamp a floating pet window so it stays reachable while still allowing the
 * artwork to hang off either screen edge. The centre grip margin keeps a
 * draggable strip on screen even for very wide pets on small displays.
 */
export function clampPetPosition(position: Point, area: Rect, dimensions: Dimensions): Point {
  const halfWidth = dimensions.width / 2;
  const grip = Math.min(36, area.width / 2);
  return {
    x: Math.round(Math.max(area.x - halfWidth + grip, Math.min(area.x + area.width - halfWidth - grip, position.x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + Math.max(0, area.height - dimensions.height), position.y))),
  };
}

export function clampPetPositionNative(
  position: Point,
  area: Rect,
  dimensions: Dimensions,
): Point {
  // Kept as a thin indirection so the renderer/main can swap in the Zig
  // implementation (native.ts) without changing call sites.
  return clampPetPosition(position, area, dimensions);
}
