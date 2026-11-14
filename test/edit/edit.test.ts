import { expect, test } from "bun:test";
import { type EditResult, edit } from "../../src/edit/edit";
import { type Args, NOUNS, type Noun, nounOf, type Verb } from "../../src/edit/table";
import type { DevItem } from "../../src/types";

const vlan = NOUNS.find((n) => n.name === "vlan")!;
const run = (
  text: string,
  verb: Verb,
  pos: string[],
  flags: Args["flags"] = {},
  noun: Noun = vlan,
  parent?: string,
): EditResult => edit(text, "t.net", { noun, verb, args: { pos, flags, ...(parent ? { parent } : {}) } });
const ok = (r: EditResult) => {
  if (!r.ok) throw new Error(`edit failed: ${r.error}`);
  return r;
};

test("vlan add appends at end", () => {
  const r = ok(run('title "T"\n# c\n', "add", ["iot", "30"], { color: "blue" }));
  expect(r.text.endsWith("# c\nvlan iot 30 color blue\n")).toBe(true);
  expect(r.line).toBe(3);
  expect(r.written).toBe("vlan iot 30 color blue");
});
test("vlan set changes only given flags, keeps comment", () => {
  const r = ok(run("vlan a 10 color red  # x\nvlan b 20\n", "set", ["a"], { color: "blue" }));
  expect(r.text).toBe("vlan a 10 color blue  # x\nvlan b 20\n");
  expect(r.line).toBe(1);
});
test("--no-color clears", () => {
  expect(ok(run("vlan a 10 color red  # x\nvlan b 20\n", "set", ["a"], { color: false })).text).toBe(
    "vlan a 10  # x\nvlan b 20\n",
  );
});
test("add existing fails", () => {
  const r = run("vlan a 10\n", "add", ["a", "11"]);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.hint).toContain("set");
});
test("missing match", () => {
  const r = run("vlan a 10\n", "rm", ["zz"]);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.hint).toContain("netink show vlans");
});
test("parse error refuses", () => {
  const r = run("vlan a\n", "add", ["b", "2"]);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toStartWith("t.net has parse errors; fix them first: ");
    expect(r.line).toBe(1);
    expect(r.hint).toBe("run netink check");
  }
});
test("an already-exists hint names only verbs the noun has", () => {
  const router = NOUNS.find((n) => n.name === "router")!;
  const r = run("device d\n  router\n", "add", [], {}, router, "d");
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.line).toBe(2);
    expect(r.hint ?? "").not.toContain("set");
  }
  const v = run("vlan a 1\n", "add", ["a", "2"]);
  if (!v.ok) expect(v.hint).toBe("use netink vlan set to change it");
});
test("--after places", () => {
  expect(ok(run("vlan a 1\nvlan b 2\n", "add", ["c", "3"], { after: "a" })).text).toBe(
    "vlan a 1\nvlan c 3\nvlan b 2\n",
  );
});
test("--before places", () => {
  const r = ok(run("vlan a 1\nvlan b 2\n", "add", ["c", "3"], { before: "b" }));
  expect(r.text).toBe("vlan a 1\nvlan c 3\nvlan b 2\n");
  expect(r.line).toBe(2);
});
test("--after a missing key fails", () => {
  expect(run("vlan a 1\n", "add", ["c", "3"], { after: "zz" }).ok).toBe(false);
});
test("rm removes the line", () => {
  const r = ok(run("vlan a 1  # gone\nvlan b 2\n", "rm", ["a"]));
  expect(r.text).toBe("vlan b 2\n");
  expect(r.written).toBe("");
  expect(r.line).toBe(1);
});
test("newline in a value is refused", () => {
  const r = run("vlan a 1\n", "set", ["a"], { color: "red\nlink" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("values cannot contain a newline");
});
test("two matches list candidates; --select-text narrows", () => {
  const text = "vlan a 1\nvlan a 2\n";
  const r = run(text, "set", ["a"], { color: "red" });
  expect(r.ok).toBe(false);
  if (!r.ok)
    expect(r.candidates).toEqual([
      { line: 1, text: "vlan a 1" },
      { line: 2, text: "vlan a 2" },
    ]);
  expect(ok(run(text, "set", ["a"], { color: "red", "select-text": "a 2" })).text).toBe(
    "vlan a 1\nvlan a 2 color red\n",
  );
});
test("rm of exact duplicate lines takes the first", () => {
  expect(ok(run("vlan a 1\nvlan b 2\nvlan a 1\n", "rm", ["a"])).text).toBe("vlan b 2\nvlan a 1\n");
});
test("set on a continued statement rewrites both lines", () => {
  expect(ok(run("vlan a 1,\n  2\nvlan b 3\n", "set", ["a"], { color: "red" })).text).toBe(
    "vlan a 1, 2 color red\nvlan b 3\n",
  );
});
test("set and add keep CRLF", () => {
  expect(ok(run("vlan a 1\r\nvlan b 2\r\n", "set", ["b"], { color: "red" })).text).toBe(
    "vlan a 1\r\nvlan b 2 color red\r\n",
  );
  expect(ok(run("vlan a 1\r\n", "add", ["c", "3"])).text).toBe("vlan a 1\r\nvlan c 3\r\n");
});
test("add without ids fails", () => {
  expect(run("", "add", ["c"]).ok).toBe(false);
});
test("nounOf takes the longest prefix", () => {
  expect(nounOf(["vlan", "add", "x"])).toEqual({ noun: vlan, rest: ["add", "x"] });
  expect(nounOf(["nope"])).toBeUndefined();
});

/** A test-local noun over top-level nodes and links, for the generic rules. */
const node: Noun = {
  name: "device",
  block: false,
  covers: ["node:device"],
  verbs: ["add", "set", "rm"],
  args: [{ name: "id" }],
  flags: [],
  help: "",
  show: "devices",
  match: (t, a) => "type" in t && t.kind === "node" && t.id === a.pos[0],
  make: (a) => ({ line: 0, kind: "node", type: "device", id: a.pos[0]! }),
  apply: (t) => [t],
};
const link: Noun = {
  name: "link",
  block: false,
  covers: ["link"],
  verbs: ["add", "set", "rm"],
  args: [{ name: "a" }, { name: "b" }],
  flags: [],
  repeatable: true,
  help: "",
  match: (t, a) => t.kind === "link" && t.path.map((e) => e.node).join(" ") === a.pos.join(" "),
  make: (a) => ({ line: 0, kind: "link", path: [{ node: a.pos[0]! }, { node: a.pos[1]! }] }),
  apply: (t, a) => (t.kind === "link" ? [{ ...t, label: a.flags.label as string }] : [t]),
};
/** A test-local block noun: `router` items under a device or bridge. */
const router: Noun = {
  name: "router",
  block: true,
  covers: ["item:router"],
  verbs: ["add", "rm"],
  args: [],
  flags: [],
  help: "",
  match: (t) => t.kind === "router",
  make: () => ({ line: 0, kind: "router" }) as DevItem,
  apply: (t) => [t],
};
const ports: Noun = {
  name: "ports",
  block: true,
  covers: ["item:ports"],
  verbs: ["add", "set"],
  args: [{ name: "names" }],
  flags: [],
  help: "",
  match: (t, a) => t.kind === "ports" && t.names.includes(a.pos[0]!),
  make: (a) => ({ line: 0, kind: "ports", names: a.pos[0]!.split(","), tagged: [] }) as DevItem,
  // split the named port onto its own line, as Task 7's ports noun will
  apply: (t, a) =>
    t.kind === "ports"
      ? [
          { ...t, names: t.names.filter((n) => n !== a.pos[0]) },
          { ...t, names: [a.pos[0]!], untagged: 10 },
        ]
      : [t],
};

test("rm device refused while referenced", () => {
  const text = 'device x\ndevice y\nlink x.e1 -- y\nnote x/br "n"\nplace y near x\nroute y -> x\nhide xy\n';
  const r = run(text, "rm", ["x"], {}, node);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toContain("3, 4, 5, 6");
    expect(r.candidates?.map((c) => c.line)).toEqual([3, 4, 5, 6]);
  }
  expect(ok(run("device x\n  router\n  # inner\ndevice y\n", "rm", ["x"], {}, node)).text).toBe("device y\n");
});
test("set a node rewrites only its own line", () => {
  expect(ok(run("device x  # c\n  router\n", "set", ["x"], {}, node)).text).toBe("device x  # c\n  router\n");
});
test("expanded line: set and rm reprint the members", () => {
  const text = "device a\ndevice b\ndevice c\nlink a -- b -- c\n";
  expect(ok(run(text, "set", ["b", "c"], { label: "L" }, link)).text).toBe(
    text.replace("link a -- b -- c", 'link a -- b\nlink b -- c label "L"'),
  );
  expect(ok(run(text, "rm", ["a", "b"], {}, link)).text).toBe(text.replace("link a -- b -- c", "link b -- c"));
});
test("repeatable add fails only on an exact duplicate", () => {
  expect(run("link a -- b\n", "add", ["a", "b"], {}, link).ok).toBe(false);
  expect(ok(run('link a -- b label "1"\n', "add", ["a", "b"], {}, link)).text).toBe(
    'link a -- b label "1"\nlink a -- b\n',
  );
});
test("block add: bare device gets its first item after its head", () => {
  expect(ok(run("device d\nvlan x 1\n", "add", [], {}, router, "d")).text).toBe("device d\n  router\nvlan x 1\n");
});
test("block add: after the bridge's last child, and at device level after the whole block", () => {
  const text = "device d\n  bridge br\n    ports e1\n  lease 10.0.0.1\nvlan x 1\n";
  const r = ok(run(text, "add", ["e2"], {}, ports, "d/br"));
  expect(r.text).toBe("device d\n  bridge br\n    ports e1\n    ports e2\n  lease 10.0.0.1\nvlan x 1\n");
  expect(r.line).toBe(4);
  expect(ok(run(text, "add", [], {}, router, "d")).text).toBe(
    "device d\n  bridge br\n    ports e1\n  lease 10.0.0.1\n  router\nvlan x 1\n",
  );
});
test("block set may split an item into two lines", () => {
  expect(ok(run("device d\n  ports e1, e2  # c\n", "set", ["e2"], {}, ports, "d")).text).toBe(
    "device d\n  ports e1  # c\n  ports e2 untagged 10\n",
  );
});
test("block: missing parent", () => {
  const r = run("device d\n", "add", [], {}, router, "zz");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.hint).toContain("netink show devices");
});

// review round 1
test("rm device refused while another device's allow item names it", () => {
  const r = run("device x\ndevice y\n  allow x -> 10.0.0.1\n", "rm", ["x"], {}, node);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.candidates).toEqual([{ line: 3, text: "allow x -> 10.0.0.1" }]);
  // its own block's allow does not block it
  expect(ok(run("device x\n  allow x -> 10.0.0.1\n", "rm", ["x"], {}, node)).text).toBe("");
});
const bridge: Noun = {
  name: "bridge",
  block: true,
  covers: ["item:bridge"],
  verbs: ["rm"],
  args: [{ name: "name" }],
  flags: [],
  help: "",
  match: (t, a) => t.kind === "bridge" && t.name === a.pos[0],
  make: () => {
    throw new Error("unused");
  },
  apply: (t) => [t],
};
test("rm of a nested block keeps a sibling-level comment after it", () => {
  expect(
    ok(run("device d\n  bridge br\n    ports e1\n    # inner\n  # uplink\n  router\n", "rm", ["br"], {}, bridge, "d"))
      .text,
  ).toBe("device d\n  # uplink\n  router\n");
});
test("remove drops part of a statement; an empty result deletes the line", () => {
  const p: Noun = {
    ...ports,
    verbs: ["rm"],
    remove: (t, a) =>
      t.kind === "ports" ? [{ ...t, names: t.names.filter((n) => n !== a.pos[0]) }].filter((x) => x.names.length) : [t],
  };
  const r = ok(run("device d\n  ports e1, e2 untagged 10  # c\n", "rm", ["e2"], {}, p, "d"));
  expect(r.text).toBe("device d\n  ports e1 untagged 10  # c\n");
  expect(ok(run("device d\n  ports e2\n  router\n", "rm", ["e2"], {}, p, "d")).text).toBe("device d\n  router\n");
});
test("last: set and rm act on the final match", () => {
  const title: Noun = {
    name: "title",
    block: false,
    covers: ["title"],
    verbs: ["add", "set", "rm"],
    args: [{ name: "text", optional: true }],
    flags: [],
    last: true,
    help: "",
    match: (t) => t.kind === "title",
    make: (a) => ({ line: 0, kind: "title", text: a.pos[0]! }),
    apply: (t, a) => (t.kind === "title" ? [{ ...t, text: a.pos[0]! }] : [t]),
  };
  const text = 'title "A"\ntitle "B"\n';
  expect(ok(run(text, "set", ["C"], {}, title)).text).toBe('title "A"\ntitle "C"\n');
  expect(ok(run(text, "rm", [], {}, title)).text).toBe('title "A"\n');
});
test("parent picks the pool: one noun serves top level and --in", () => {
  const allow: Noun = {
    name: "allow",
    block: false,
    covers: ["allow", "item:allow"],
    verbs: ["add"],
    args: [{ name: "from" }, { name: "to" }],
    flags: [],
    help: "",
    match: (t, a) => t.kind === "allow" && t.from === a.pos[0] && t.to === a.pos[1],
    make: (a) => ({ line: 0, kind: "allow", from: a.pos[0]!, to: a.pos[1]! }),
    apply: (t) => [t],
  };
  const text = "device r\nvlan x 1\n";
  expect(ok(run(text, "add", ["e1", "h"], {}, allow, "r")).text).toBe("device r\n  allow e1 -> h\nvlan x 1\n");
  expect(ok(run(text, "add", ["e1", "h"], {}, allow)).text).toBe("device r\nvlan x 1\nallow e1 -> h\n");
  expect(run(text, "add", [], {}, router).ok).toBe(false); // a block noun still requires a parent
});
test("upsert: set with no match adds", () => {
  const style: Noun = {
    name: "style",
    block: false,
    covers: ["style"],
    verbs: ["set"],
    args: [{ name: "key" }, { name: "value" }],
    flags: [],
    upsert: true,
    help: "",
    match: (t, a) => t.kind === "style" && t.key === a.pos[0],
    make: (a) => ({ line: 0, kind: "style", key: "jumps", value: a.pos[1] as "arc" }),
    apply: (t, a) => (t.kind === "style" ? [{ ...t, value: a.pos[1] as "arc" }] : [t]),
  };
  expect(ok(run("vlan a 1\n", "set", ["jumps", "gap"], {}, style)).text).toBe("vlan a 1\nstyle jumps gap\n");
  expect(ok(run("style jumps arc\n", "set", ["jumps", "gap"], {}, style)).text).toBe("style jumps gap\n");
});
test("--after with --before is refused", () => {
  const r = run("vlan a 1\nvlan b 2\n", "add", ["c", "3"], { after: "a", before: "b" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("use either --after or --before");
});

test("output the parser would reject is refused, text unchanged", () => {
  for (const [pos, flags] of [
    [["v", "10"], { color: "chartreuse" }],
    [["v w", "10"], {}],
    [["v", "10"], { subnet: "a b" }],
  ] as [string[], Args["flags"]][]) {
    const r = run("", "add", pos, flags);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  }
});
