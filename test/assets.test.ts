import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const FILES = ["assets/logo.svg", "assets/logo-512.png", "assets/wordmark-light.svg", "assets/wordmark-dark.svg"];
const SVGS = FILES.filter((f) => f.endsWith(".svg"));

test("logo files exist and are tracked", () => {
  const tracked = Bun.spawnSync(["git", "ls-files", "assets"]).stdout.toString().split("\n");
  for (const f of FILES) expect(tracked).toContain(f);
});

test("logo svgs contain no <text>", () => {
  for (const f of SVGS) expect(readFileSync(f, "utf8")).not.toMatch(/<text[\s>]/);
});

test("icon is centred", () => {
  const svg = readFileSync("assets/logo.svg", "utf8");
  expect(svg).toContain('viewBox="0 0 64 64"');
  const path = svg.match(/<path [^>]*d="([^"]+)"[^>]*>/)!;
  const half = Number(path[0].match(/stroke-width="([\d.]+)"/)![1]) / 2;
  // M/L/Q absolute coords only: every number pair is a point; pad by half the stroke for the inked extent
  const nums = path[1].match(/-?[\d.]+/g)!.map(Number);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    xs.push(nums[i] - half, nums[i] + half);
    ys.push(nums[i + 1] - half, nums[i + 1] + half);
  }
  // device boxes: the white rects (the tile is the first rect)
  const rects = [...svg.matchAll(/<rect ([^>]*)>/g)].map((m) => m[1]).filter((a) => a.includes('fill="#fff"'));
  expect(rects).toHaveLength(2);
  for (const a of rects) {
    const n = (k: string) => Number(a.match(new RegExp(`\\b${k}="([\\d.]+)"`))![1]);
    xs.push(n("x"), n("x") + n("width"));
    ys.push(n("y"), n("y") + n("height"));
  }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  expect(Math.abs(cx - 32)).toBeLessThanOrEqual(1);
  expect(Math.abs(cy - 32)).toBeLessThanOrEqual(2);
});

test("png is 512x512", () => {
  const b = readFileSync("assets/logo-512.png");
  expect(b.readUInt32BE(16)).toBe(512);
  expect(b.readUInt32BE(20)).toBe(512);
});
