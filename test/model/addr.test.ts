import { expect, test } from "bun:test";
import { inPrefix, parseCidr } from "../../src/model/addr";

test("inPrefix", () => {
  expect(inPrefix("2001:db8:50::1", "2001:db8:50::/64")).toBe(true);
  expect(inPrefix("2001:db8:51::1", "2001:db8:50::/64")).toBe(false);
  expect(inPrefix("10.50.0.1/24", "10.50.0.0/24")).toBe(true);
  expect(inPrefix("10.50.1.1", "10.50.0.0/24")).toBe(false);
  expect(inPrefix("10.50.0.1", "2001:db8::/32")).toBe(false);
  expect(inPrefix("nonsense", "10.0.0.0/8")).toBe(false);
});
test("parseCidr", () => {
  expect(parseCidr("::")).toEqual({ v: 6, net: 0n, len: 128 });
  expect(parseCidr("2001:db8::/32")).toEqual({ v: 6, net: 0x20010db8n << 96n, len: 32 });
  expect(parseCidr("10.1.2.3/8")).toEqual({ v: 4, net: 10n << 24n, len: 8 });
  for (const bad of [
    "",
    "1.2.3",
    "1.2.3.256",
    "10.0.0.0/33",
    "::1::2",
    "fe80::1%eth0",
    "::ffff:1.2.3.4",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7::8",
  ])
    expect(parseCidr(bad)).toBeUndefined();
});
