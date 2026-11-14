import dslDoc from "../docs/dsl.md" with { type: "text" };
import { NOUNS } from "./edit/table";
import { COMPLETION, DESC, EDITING, EXIT, JSON_OUT } from "./help";

const code = (s: string) => `\`\`\`\n${s}\n\`\`\``;

/** Push markdown headings two levels down (`#` → `###`), leaving fenced code alone. */
export function demote(md: string): string {
  let fenced = false;
  return md
    .split("\n")
    .map((l) => {
      if (l.startsWith("```")) fenced = !fenced;
      return !fenced && /^#{1,4}\s/.test(l) ? `##${l}` : l;
    })
    .join("\n");
}

/** The man page as marked-man markdown, built from the same definitions --help uses. */
export function manPage(): string {
  const commands = Object.entries(DESC)
    .map(([n, d]) => `* \`${n}\`:\n  ${d}`)
    .join("\n");
  const editing = NOUNS.map((n) => {
    const flags = n.flags.map((f) => `  * \`--${f.name}\`: ${f.help}`).join("\n");
    return `* \`${n.help}\`${flags ? `\n${flags}` : ""}`;
  }).join("\n");
  return `netink(1) -- render network diagrams from a DSL
==================================================

## SYNOPSIS

\`netink\` <command> [options]

\`netink\` <noun> add|set|rm <key...> [flags]

## DESCRIPTION

Render network diagrams from a line-oriented DSL plus optional MikroTik .rsc exports.
Every command reads \`--file\` (default ./network.net) and takes \`--json\`.
\`netink --version\` prints the version.

## COMMANDS

${commands}

## EDITING COMMANDS

${code(EDITING)}

${editing}

## JSON OUTPUT

${code(JSON_OUT)}

## EXIT STATUS

${code(EXIT)}

## SHELL COMPLETION

${code(COMPLETION)}

## DSL

${demote(dslDoc.trim())}
`;
}
