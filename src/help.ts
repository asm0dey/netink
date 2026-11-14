import { NAMED } from "./model/style";

export const GRAMMAR = `DSL (line-oriented; '#' to end of line is a comment unless inside quotes; a line ending in ',' continues on the next line;
strings are "..." with \\" and \\\\ escapes):

  title "T"                      subtitle "T"
  imports rsc <path> as <id> (, <path> as <id>)*
  vlan <name> (untagged | <n>(,<n>)*) [color <c>] [subnet <cidr>(, <cidr>)*]   c = a name below, or quoted hex "#rrggbb"
  cloud <id> ["label"]
  device <id> ["label"] [kind <role>] [model "m"] [os "o"] [note "n"]
    indented blocks (two spaces per level) under a device; names are local, "quoted" allowed:
      wan <if> [on <parent> vlan <n>] [route "name"] [distance <n>] [dhcp [<addr>]] [nat]
      router
      bridge <name> [address <cidr>(, <cidr>)*] [lan] [guest] [hotspot] [filtering]   (children indented again: ports, vlan-iface, radio)
      ports <p>(, <p>)* [untagged <vlan>] [tagged <vlan>(, <vlan>)*] [horizon <n>]     <vlan> = name or id
      vlan-iface <name> [on <parent>] vlan <n> [address <cidr>(, <cidr>)*] [lan] [guest] [hotspot]
      radio <if>(, <if>)* [tag <n>] [ssid <s>(, <s>)*]
      address <if> <cidr>(, <cidr>)* [lan] [guest] [hotspot]
      lease <addr> ["comment"]
      allow <if> -> <addr-or-id> ["label"]
  client <id> ["label"] [lease <ip>] [note "n"]
  trunk <name> vlans <vlan>(, <vlan>)*                          named VLAN set, drawn as one trunk bar
  link <ep> (-- <ep>)+ [vlans <name>(,<name>)* | trunk <name>] [label "l"]     ep = id | id.port ; final ep may be id(, id)* (fan-out)
  note <target> "text"           place <a> near <b>      row <a>(, <b>)+
  <device>.side <group> = top|bottom|left|right
  legend auto|off | legend add <style> "text" | legend remove <entry> | legend note "text" | legend position bottom|right
  style jumps arc|gap|none
  route <a> -> <b> ["label"]     allow <a> -> <b> ["label"]     hide <target>

  'link a -- b -- c.p' expands to two links (a-b, b-c.p); 'link sw -- x, y' expands to sw-x and sw-y.
  colors: ${Object.keys(NAMED).join(", ")}
  Ids are [a-z0-9_-]+; child ids are parent/child (e.g. core/ether3, core/bridge).
  Paths in 'imports' are relative to the .net file.`;

export const EDITING = `Editing: netdraw <noun> add|set|rm <key...> [flags] [--file f] [--json] edits the file in place, one statement per command.
  Block nouns (wan, bridge, ports, ...) take the parent first: netdraw ports add core/bridge ether2,ether3 --untagged home.
  allow --in <device> edits the line inside that device's block. Lists are one comma-separated argument.
  --after <key> / --before <key> place a new statement next to a statement of the same kind (default: end of file or block);
  --select-text <s> picks one of several matches; --no-<flag> clears an optional value.
  For a value starting with -: use --flag=value, or put positionals after --  (netdraw note add d -- '-> uplink').
  The written lines go to stdout, then check runs and prints its diagnostics (exit 0 once written).
  netdraw <noun> --help lists its verbs and flags. netdraw init creates the empty file to start from.`;
export const JSON_OUT = `--json output:
  render  {ok, output, width, height, warnings} (plus "svg" when no -o); on refusal {ok:false, diags}
  check   {ok, diags}
  show    the raw model objects
  import  {ok, stmt, diags}
  editing {ok, file, line, text, diags}; a refused edit is exit 1 with the error shape plus "candidates" when ambiguous
  error   {"error", "file", "line", "hint"?} on stdout, for every failure
  diag    {"level": "error"|"warning", "file", "line", "message", "hint"?}`;
export const EXIT = `Exit codes: 0 ok; 1 model/check errors or runtime failure; 2 usage error (unknown command, unknown flag, missing argument).
No command prompts interactively.`;
export const COMPLETION = `Shell completion: netdraw completion >> ~/.zshrc  (zsh or bash, from $SHELL; completes commands, nouns, verbs, flags and the ids and vlan names in the --file)`;
export const EPILOGUE = `${EDITING}

${JSON_OUT}

${EXIT}

${COMPLETION}

DSL reference: netdraw help dsl`;

/** The one-line command descriptions, shared by --help and the man page. */
export const DESC = {
  render:
    "write the SVG to -o, or to stdout; refuses (exit 1) when check reports errors, warnings do not block; slice or filter with --view combined|physical|vlans|routing, --vlan, --around [--depth], --path a b, --address; --no-collapse draws every device",
  check: "exit 0 with no errors, 1 otherwise; diagnostics file:line: level: message (hint) on stderr",
  show: "print the merged model slice: devices, links, vlans, trunks, or one <id> (node subtree, link or arrow)",
  import: "print the device block for a router .rsc export, ready to paste in place of its import",
  init: "create an empty DSL file (default ./network.net); exit 1 if it exists",
  completion: "print a shell completion script (zsh or bash, from $SHELL)",
};
