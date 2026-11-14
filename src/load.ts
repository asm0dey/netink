import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { parseDsl } from "./dsl/parse";
import { buildFromStmts, type Opts, vlanDefs } from "./model/build";
import { importRsc } from "./rsc/import";
import { translate } from "./rsc/translate";
import type { DeviceFacts, Diag, Model, Stmt } from "./types";

/** Imports are translated to `device` blocks, spliced in place of their `import` line, and built like hand-written ones. */
export function buildModel(stmts: Stmt[], facts: Map<string, DeviceFacts>, opts: Opts = {}): Model {
  const file = opts.file ?? "";
  const diags: Diag[] = [];
  const err = (line: number, message: string, hint?: string) =>
    diags.push({ level: "error", file, line, message, ...(hint ? { hint } : {}) });
  const seen = new Set<string>();
  const imports = stmts
    .filter((s): s is Extract<Stmt, { kind: "import" }> => s.kind === "import")
    .filter((s) => {
      if (seen.has(s.as)) {
        err(s.line, `"${s.as}" is imported twice`, "give each import its own alias");
        return false;
      }
      seen.add(s.as);
      if (facts.has(s.as)) return true;
      err(s.line, `no facts loaded for import "${s.as}"`);
      return false;
    });
  const t = translate(
    imports.map((s) => ({ id: s.as, line: s.line, f: facts.get(s.as)! })),
    vlanDefs(stmts),
  );
  diags.push(...t.diags);
  const spliced = stmts.map((s): Stmt => {
    if (s.kind === "import") return imports.includes(s) ? t.stmts[imports.indexOf(s)]! : s; // a rejected import stays, for its id check
    const imp = s.kind === "node" && s.items ? imports.find((i) => i.as === s.id) : undefined;
    if (!imp || s.kind !== "node") return s;
    err(
      s.line,
      `"${s.id}" is imported; its internals come from ${imp.file}`,
      `run netink import ${imp.file} to get an editable block`,
    );
    const { items: _, ...rest } = s;
    return rest;
  });
  const m = buildFromStmts(spliced, opts);
  m.diags = [...diags, ...m.diags];
  return m;
}

export function loadModel(file: string, opts: { all?: boolean } = {}): Model {
  const { stmts, diags } = parseDsl(readFileSync(file, "utf8"), file);
  const facts = new Map<string, DeviceFacts>();
  for (const s of stmts) {
    if (s.kind !== "import") continue;
    // not resolve(): relative imports keep relative paths in diagnostics
    const path = isAbsolute(s.file) ? s.file : join(dirname(file), s.file);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      diags.push({
        level: "error",
        file,
        line: s.line,
        message: `cannot read ${s.file}`,
        hint: "paths are relative to the .net file",
      });
      continue;
    }
    const f = importRsc(text, path, s.as);
    facts.set(s.as, f);
    diags.push(...f.warnings);
  }
  const m = buildModel(stmts, facts, { ...opts, file });
  m.diags = [...diags, ...m.diags];
  return m;
}
