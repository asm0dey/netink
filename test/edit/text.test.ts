import { expect, test } from "bun:test";
import { commentOf, insertAfter, replaceLines } from "../../src/edit/text";

test("replace keeps other bytes", () => {
  expect(replaceLines("a\nb\nc\n", 2, 2, ["B"])).toBe("a\nB\nc\n");
});
test("replace keeps trailing comment", () => {
  expect(replaceLines("x 1   # keep\n", 1, 1, ["x 2"])).toBe("x 2   # keep\n");
});
test("hash inside quotes is not a comment", () => {
  expect(commentOf('note a "#1"')).toBeUndefined();
  expect(commentOf("x 1   # keep")).toBe("# keep");
});
test("delete lines", () => {
  expect(replaceLines("a\nb\nc\n", 2, 2, [])).toBe("a\nc\n");
});
test("crlf preserved", () => {
  expect(insertAfter("a\r\nb\r\n", 1, ["x"])).toBe("a\r\nx\r\nb\r\n");
  expect(replaceLines("a\r\nb\r\n", 1, 1, ["x", "y"])).toBe("x\r\ny\r\nb\r\n");
});
test("append without trailing newline", () => {
  expect(insertAfter("a", 1, ["b"])).toBe("a\nb\n");
});
test("append to empty", () => {
  expect(insertAfter("", 0, ["a"])).toBe("a\n");
});
