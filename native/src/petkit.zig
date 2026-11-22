//! petkit: the Zig sidecar behind src/core/native.ts.
//!
//! It speaks newline-delimited JSON on stdin/stdout so the Electron main
//! process can keep per-frame decisions (window clamping, activity
//! classification, quota freshness) in compiled code:
//!
//!   {"id":1,"op":"ping"}
//!   {"id":2,"op":"clamp","value":740,"low":0,"high":720}
//!   {"id":3,"op":"classify","requests":2,"waiting":1,"tools":0}
//!   {"id":4,"op":"fresh","readAt":1700000000000,"now":1700000001000,"ttlMs":30000}
//!
//! Every request is answered with `{"id":<id>,"ok":true,"value":<number>}`.
//! A malformed line gets `{"id":<echoed-or-0>,"ok":false}` and the loop keeps
//! running, so one bad message cannot take the sidecar down.

const std = @import("std");
const Io = std.Io;

/// 0 idle, 1 thinking, 2 waiting, 3 working. Mirrors `tsActivityState`.
pub fn classify(requests: i64, waiting: i64, tools: i64) u8 {
    if (requests > waiting) return 1;
    if (waiting > 0) return 2;
    if (tools > 0) return 3;
    return 0;
}

/// Same result as `Math.max(low, Math.min(high, value))`.
pub fn clampValue(value: f64, low: f64, high: f64) f64 {
    const bounded = if (value < high) value else high;
    return if (bounded > low) bounded else low;
}

/// A reading taken at `read_at` counts as fresh until `ttl_ms` has elapsed,
/// and never when the clock went backwards.
pub fn fresh(read_at: f64, now: f64, ttl_ms: f64) bool {
    if (!std.math.isFinite(read_at) or !std.math.isFinite(now) or !std.math.isFinite(ttl_ms)) return false;
    return now >= read_at and (now - read_at) <= ttl_ms;
}

fn numberOr(value: ?std.json.Value, fallback: f64) f64 {
    const entry = value orelse return fallback;
    return switch (entry) {
        .integer => |i| @floatFromInt(i),
        .float => |f| f,
        .number_string => |s| std.fmt.parseFloat(f64, s) catch fallback,
        else => fallback,
    };
}

fn idOr(root: std.json.Value) i64 {
    if (root != .object) return 0;
    const entry = root.object.get("id") orelse return 0;
    return switch (entry) {
        .integer => |i| i,
        .float => |f| @intFromFloat(f),
        .number_string => |s| std.fmt.parseInt(i64, s, 10) catch 0,
        else => 0,
    };
}

fn reply(writer: *Io.Writer, id: i64, value: f64) !void {
    if (value == @floor(value) and @abs(value) < 9.0e15) {
        try writer.print("{{\"id\":{d},\"ok\":true,\"value\":{d}}}\n", .{ id, @as(i64, @intFromFloat(value)) });
    } else {
        try writer.print("{{\"id\":{d},\"ok\":true,\"value\":{d}}}\n", .{ id, value });
    }
    try writer.flush();
}

fn reject(writer: *Io.Writer, id: i64) !void {
    try writer.print("{{\"id\":{d},\"ok\":false}}\n", .{id});
    try writer.flush();
}

fn handleLine(allocator: std.mem.Allocator, line: []const u8, writer: *Io.Writer) !void {
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch {
        try reject(writer, 0);
        return;
    };
    defer parsed.deinit();
    const root = parsed.value;
    const id = idOr(root);
    if (root != .object) {
        try reject(writer, id);
        return;
    }
    const object = root.object;
    const op = blk: {
        const entry = object.get("op") orelse break :blk "";
        break :blk switch (entry) {
            .string => |s| s,
            else => "",
        };
    };
    const value = if (std.mem.eql(u8, op, "ping"))
        1.0
    else if (std.mem.eql(u8, op, "clamp"))
        clampValue(
            numberOr(object.get("value"), 0),
            numberOr(object.get("low"), 0),
            numberOr(object.get("high"), 0),
        )
    else if (std.mem.eql(u8, op, "classify"))
        @as(f64, @floatFromInt(classify(
            @intFromFloat(numberOr(object.get("requests"), 0)),
            @intFromFloat(numberOr(object.get("waiting"), 0)),
            @intFromFloat(numberOr(object.get("tools"), 0)),
        )))
    else if (std.mem.eql(u8, op, "fresh"))
        @as(f64, if (fresh(
            numberOr(object.get("readAt"), 0),
            numberOr(object.get("now"), 0),
            numberOr(object.get("ttlMs"), 0),
        )) 1 else 0)
    else {
        try reject(writer, id);
        return;
    };
    try reply(writer, id, value);
}

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const gpa = init.gpa;

    var read_buffer: [16 * 1024]u8 = undefined;
    var stdin_reader = Io.File.stdin().reader(io, &read_buffer);
    const reader = &stdin_reader.interface;

    var write_buffer: [16 * 1024]u8 = undefined;
    var stdout_writer = Io.File.stdout().writer(io, &write_buffer);
    const writer = &stdout_writer.interface;

    while (true) {
        const maybe_line = reader.takeDelimiter('\n') catch break;
        const raw = maybe_line orelse break;
        const line = std.mem.trim(u8, raw, " \t\r");
        if (line.len == 0) continue;
        handleLine(gpa, line, writer) catch |err| switch (err) {
            else => {
                reject(writer, 0) catch break;
            },
        };
    }
}

test "classify mirrors the TypeScript precedence" {
    try std.testing.expectEqual(@as(u8, 1), classify(3, 1, 0));
    try std.testing.expectEqual(@as(u8, 1), classify(1, 0, 0));
    try std.testing.expectEqual(@as(u8, 2), classify(1, 1, 0));
    try std.testing.expectEqual(@as(u8, 2), classify(0, 1, 4));
    try std.testing.expectEqual(@as(u8, 3), classify(0, 0, 2));
    try std.testing.expectEqual(@as(u8, 0), classify(0, 0, 0));
}

test "clamp stays inside the inclusive bounds" {
    try std.testing.expectEqual(@as(f64, 720), clampValue(740, 0, 720));
    try std.testing.expectEqual(@as(f64, 0), clampValue(-40, 0, 720));
    try std.testing.expectEqual(@as(f64, 305), clampValue(305, 0, 720));
    try std.testing.expectEqual(@as(f64, 10), clampValue(10, 0, 720));
    try std.testing.expectEqual(@as(f64, 50), clampValue(10, 50, 40));
}

test "fresh respects the ttl and clock skew" {
    try std.testing.expect(fresh(1_000, 1_500, 600));
    try std.testing.expect(fresh(1_000, 1_600, 600));
    try std.testing.expect(!fresh(1_000, 1_601, 600));
    try std.testing.expect(!fresh(2_000, 1_000, 600));
    try std.testing.expect(!fresh(std.math.nan(f64), 1_000, 600));
}
