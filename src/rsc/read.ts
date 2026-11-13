import type { Diag, RscCommand } from "../types";

const VERBS: Record<string, RscCommand["verb"]> = {
  add: "add",
  set: "set",
  remove: "remove",
  disable: "other",
  enable: "other",
  unset: "other",
  print: "other",
  export: "other",
};
type Tok = { key?: string; val: string; q?: boolean };
const ESC: Record<string, string> = { '"': '"', "\\": "\\", $: "$" };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i]!)) {
      i++;
      continue;
    }
    let key: string | undefined,
      buf = "",
      bare = true;
    while (i < s.length && !/\s/.test(s[i]!)) {
      const c = s[i]!;
      if (c === '"') {
        bare = false;
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === "\\" && i + 1 < s.length) {
            const n = s[i + 1]!;
            buf += n in ESC ? ESC[n]! : "\\" + n;
            i += 2;
          } else buf += s[i++]!;
        }
        i++;
      } else if (c === "=" && key === undefined && bare && buf) {
        key = buf;
        buf = "";
        i++;
      } else {
        buf += c;
        i++;
      }
    }
    out.push({ key, val: buf, q: !bare });
  }
  return out;
}

export function readRsc(
  text: string,
  file: string,
): { cmds: RscCommand[]; header: { model?: string; version?: string }; warnings: Diag[] } {
  const cmds: RscCommand[] = [],
    warnings: Diag[] = [],
    header: { model?: string; version?: string } = {};
  const warn = (line: number, message: string) => warnings.push({ level: "warning", file, line, message });
  const lines = text.split(/\r?\n/);
  let cur: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    const start = n + 1;
    let ln = lines[n]!.trim();
    if (ln.startsWith("#")) {
      let m: RegExpMatchArray | null;
      if (header.version === undefined && (m = ln.match(/by RouterOS (\d\S*)/))) header.version = m[1];
      if (header.model === undefined && (m = ln.match(/^#\s*model\s*=\s*(.+)$/))) header.model = m[1]!.trim();
      if (
        (header.model === undefined || header.version === undefined) &&
        (m = ln.match(/^#\s*\S+ - (.+?), [\d.]+, RouterOS (\d\S*)/))
      ) {
        header.model ??= m[1]!;
        header.version ??= m[2];
      }
      continue;
    }
    while (ln.endsWith("\\") && n + 1 < lines.length) ln = ln.slice(0, -1) + lines[++n]!.trimStart();
    ln = ln.trim();
    if (!ln) continue;
    if (ln[0] === ":" || ln === "{" || ln === "}") {
      warn(start, `scripting line skipped: ${ln.slice(0, 40)}`);
      continue;
    }

    const toks = tokenize(ln);
    const tk = (k: number) => toks[k]!;
    let words: string[] = [];
    let i = 0;
    if (tk(0).key === undefined && tk(0).val.startsWith("/")) {
      toks[0] = { val: tk(0).val.slice(1) };
      if (!tk(0).val) i = 1;
    } else words = [...cur];
    while (i < toks.length && tk(i).key === undefined && !(tk(i).val in VERBS)) words.push(tk(i++).val);
    if (i >= toks.length) {
      cur = words;
      continue;
    }
    if (tk(i).key !== undefined) {
      warn(start, `unparsed token "${tk(i).key}=${tk(i).val}"`);
      continue;
    }
    const verb = VERBS[tk(i++).val]!;
    const cmd: RscCommand = { path: "/" + words.join(" "), verb, props: {}, line: start };
    const put = (t: Tok) => {
      let { key, val } = t;
      if (key !== undefined) {
        // fused "a=1b=2": the value swallowed the next key
        const m = val.match(/^(.+?)([a-z][a-z0-9-]*)=(.*)$/s);
        if (m && !t.q) {
          warn(start, `fused tokens "${key}=${val}" split into ${key} and ${m[2]}`);
          cmd.props[key] = m[1]!;
          key = m[2]!;
          val = m[3]!;
        }
        cmd.props[key] = val;
      } else warn(start, `unparsed token "${val}"`);
    };
    for (; i < toks.length; i++) {
      const t = tk(i);
      if (t.key === undefined && t.val === "[") {
        const find: Record<string, string> = {};
        for (i++; i < toks.length && tk(i).val !== "]"; i++) if (tk(i).key !== undefined) find[tk(i).key!] = tk(i).val;
        cmd.find = find;
      } else if (
        t.key === undefined &&
        !cmd.find &&
        (verb === "set" || verb === "remove") &&
        Object.keys(cmd.props).length === 0
      ) {
        cmd.find = { name: t.val };
      } else if (verb === "other" && t.key === undefined) continue;
      else put(t);
    }
    cmds.push(cmd);
  }
  return { cmds, header, warnings };
}
