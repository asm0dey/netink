# The netink command line

netink is one command with a handful of subcommands. Some read a `.net`
file and report on it (`check`, `show`), one draws it (`render`), and the
rest edit it one line at a time, so you can build a diagram from a script
or a terminal without opening an editor.

This page explains every command and flag. The language the file is written
in has its own page, [the DSL reference](dsl.md); read that first if you
have never seen a `.net` file.

Every example on this page is run by netink's test suite, in order, in one
empty directory. A line starting with `$` is a command; the lines under it
are exactly what it prints on stdout. Diagnostics and errors go to stderr
and are not shown.

## Global flags

These work with every command.

- `--file <path>`: the DSL file to read or edit. The default is
  `./network.net`.
- `--json`: print one JSON document on stdout instead of text, for scripts.
  The shapes are listed under [JSON output](#json-output).
- `--version`: print the netink version and exit.
- `--help` (or `-h`): print the usage of netink, or of one command when it
  follows the command name: `netink render --help`.

```console
$ netink --version
0.0.0-dev
```

A build from a release prints its version, for example `0.1.0`; running
from a checkout prints `0.0.0-dev`.

## Commands

### `netink init`

```text
netink init [path]
```

Creates an empty DSL file to start from: `path` if given, otherwise
`./network.net` (the `--file` default). It refuses, with exit 1, to
overwrite a file that exists.

```console
$ netink init bakery.net
$ netink init bakery.net # exit 1
```

The rest of the commands on this page read `bakery.net`, filled in with a
small bakery: a router, a ceiling access point with a staff and a guest
Wi-Fi, an office laptop and a till printer.

```net file=bakery.net
title "Corner Bakery"
subtitle "Shop floor"

vlan staff untagged color green subnet 192.168.10.0/24
vlan guest 20       color blue  subnet 10.20.0.0/24

cloud internet "Internet"

device gw model "Edge 5"
  wan ether1 dhcp nat
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2, ether3
  vlan-iface vlan20 on lan vlan 20 address 10.20.0.1/24 guest
  lease 192.168.10.50 "Till printer"
  allow vlan20 -> 192.168.10.50 "guests may print"

device ap "Ceiling AP"
  bridge br
    ports eth0, eth1
    radio wlan0 ssid BakeryStaff
    radio wlan0-guest tag 20 ssid BakeryGuest

client laptop "Office laptop"
client till lease 192.168.10.50

link internet -- gw.ether1
link gw.ether2 -- ap.eth0
link gw.ether3 -- laptop
link ap.wlan0 -- till

note ap "above the counter"
```

### `netink check`

```text
netink check [--all]
```

Reads the file and reports mistakes. It prints nothing and exits 0 when
there are no errors; warnings are printed but do not change the exit code.
Each diagnostic is one line on stderr:

```text
<file>:<line>: <error|warning>: <message> (<hint>)
```

With an error anywhere, the exit code is 1.

- `--all`: also consider spare parts, such as unused ports, that netink
  normally leaves out.

```console
$ netink check --file bakery.net
```

A file with a mistake:

```text file=broken.net
device gw
client pc
link gw -- pc vlans office
```

```console
$ netink check --file broken.net # exit 1
```

prints `broken.net:3: error: unknown vlan "office" (declare it with vlan
office <ids>)` on stderr.

### `netink render`

```text
netink render [-o <file.svg>] [--view combined|physical|vlans|routing]
              [--vlan <v>]... [--around <id> [--depth <n>]] [--path <a> <b>]
              [--address <ip-or-prefix>] [--all] [--no-collapse]
```

Draws the file as SVG. It runs `check` first and refuses, with exit 1, when
`check` reports errors; warnings are printed and do not block.

- `-o <file.svg>`: write the SVG there. Without `-o` the SVG goes to stdout.
- `--view`: which layers to draw. `combined` (the default) draws
  everything; `physical` draws only the cables, without VLAN lanes or
  arrows; `vlans` draws cables and VLAN lanes but no routing arrows;
  `routing` draws only routers and their arrows.
- `--vlan <v>`: keep only the devices that carry VLAN `v` (a name or a tag
  number). Repeat it for several VLANs.
- `--around <id>`: keep only `id` and the devices up to `--depth` links away
  from it (default 1).
- `--depth <n>`: how many links `--around` follows.
- `--path <a> <b>`: keep only the devices on a shortest path between `a`
  and `b`.
- `--address <ip-or-prefix>`: keep the devices that have an address in or
  around that IP or prefix, and the VLANs whose subnet it meets.
- `--all`: draw spare parts, such as unused ports.
- `--collapse` is on by default: identical leaf siblings (say, ten
  identical cameras on one switch) are merged into one box.
  `--no-collapse` draws each one.

The filters combine: each one narrows what the previous left.

```console
$ netink render --file bakery.net -o bakery.svg
$ netink render --file bakery.net -o guest.svg --vlan guest
$ netink render --file bakery.net -o till.svg --path laptop till
$ netink render --file bakery.net -o ap.svg --around ap --depth 1
$ netink render --file bakery.net -o guests.svg --address 10.20.0.0/24
$ netink render --file bakery.net -o routing.svg --view routing --all --no-collapse
```

With `--json`, `render` prints the file it wrote and the picture's size:

```console
$ netink render --file bakery.net -o bakery.svg --json
{"ok":true,"output":"bakery.svg","width":738,"height":1362,"warnings":[]}
```

`render --file broken.net -o broken.svg` exits 1 and writes nothing.

### `netink show`

```text
netink show [devices | links | vlans | trunks | <id>] [--all]
```

Prints the model netink builds from the file, after imports are read and
the rules in [how netink fills in the rest](dsl.md#how-netink-fills-in-the-rest)
are applied. Use it to find the ids other commands take, and to see what a
line in the file turned into.

- No argument or `devices`: every box, with its children indented under it.
  Each line is `<id> (<kind>) <label>`, with notes or addresses in brackets.
- `links`: every cable, with the VLAN lanes netink drew on it.
- `vlans`, `trunks`: the declared VLANs and named trunks.
- `<id>`: one device or client with its children, or one link or arrow as
  JSON.
- `--all`: include spare parts, such as unused ports.

```console
$ netink show --file bakery.net ap
ap (device) Ceiling AP  [above the counter]
  ap/br (group) br
    ap/eth0 (port) eth0
    ap/radio-br (radio) wlan0  [BakeryStaff]
    ap/radio-br-tag20 (radio) wlan0-guest · use-tag 20  [BakeryGuest]
$ netink show --file bakery.net --all ap
ap (device) Ceiling AP  [above the counter]
  ap/br (group) br
    ap/eth0 (port) eth0
    ap/eth1 (port) eth1
    ap/radio-br (radio) wlan0  [BakeryStaff]
    ap/radio-br-tag20 (radio) wlan0-guest · use-tag 20  [BakeryGuest]
$ netink show --file bakery.net vlans
staff: untagged  green  192.168.10.0/24
guest: 20  blue  10.20.0.0/24
$ netink show --file bakery.net links
internet--gw/ether1: internet -- gw/ether1  lanes: wire
gw/ether2--ap/eth0: gw/ether2 -- ap/eth0  lanes: staff, guest
gw/ether3--laptop: gw/ether3 -- laptop  lanes: staff
ap/radio-br--till: ap/radio-br -- till  lanes: staff
gw/ether2--gw/vlan20: gw/vlan20 -- gw/ether2  lanes: guest
ap/eth0--ap/radio-br: ap/eth0 -- ap/radio-br  lanes: staff
ap/eth0--ap/radio-br-tag20: ap/eth0 -- ap/radio-br-tag20  lanes: guest
```

An arrow id is `<route|allow>:<from>-><to>` with the child ids above:

```console
$ netink show --file bakery.net allow:gw/vlan20->till
{
  "id": "allow:gw/vlan20->till",
  "from": "gw/vlan20",
  "to": "till",
  "kind": "allow",
  "label": "guests may print"
}
```

An unknown id exits 1.

### `netink import`

`import` does two different things.

```text
netink import <file.rsc> --as <id>
netink import add|set|rm <file.rsc> --as <id>
```

`netink import <file.rsc> --as <id>` reads a MikroTik RouterOS export and
prints the device block it turns into, with `id` as the device id. Paste
the block into your file to stop depending on the export. `--as` names the
device; it is required.

Say the branch router's export is saved as `edge.rsc`:

```rsc file=edge.rsc
/system identity set name=edge
/interface bridge add name=bridge
/interface bridge port add bridge=bridge interface=ether2
/ip address add address=192.168.30.1/24 interface=bridge
/interface list add name=WAN
/interface list member add list=WAN interface=ether1
/ip dhcp-client add interface=ether1
/ip firewall nat add chain=srcnat action=masquerade out-interface-list=WAN
```

```console
$ netink import edge.rsc --as edge
device edge
  wan ether1 dhcp nat
  router
  bridge bridge address 192.168.30.1/24
    ports ether2
```

`netink import add|set|rm` is the [editing](#editing-the-file) command for
the file's `imports rsc <path> as <id>` line, which reads the export on
every run instead (see [`imports`](dsl.md#imports)). `set` changes the path
of the import with id `--as`; `rm` deletes it. Like every editing command
it takes `--after <key>` and `--before <key>` to place a new line and
`--select-text <s>` to pick one of several matches (see
[placing and choosing](#placing-and-choosing)).

```console
$ netink init branch.net
$ netink import add edge.rsc --as edge --file branch.net
imports rsc edge.rsc as edge
$ netink show edge --file branch.net
edge (device) EDGE
  edge/wan (group) WAN
    edge/ether1 (port) ether1  [DHCP client]
  edge/router (router) routing · NAT · firewall
  edge/bridge (group) bridge · 192.168.30.1/24
    edge/ether2 (port) ether2
```

### `netink help`

```text
netink help
netink help dsl
```

`netink help` prints the same overview as `netink --help`: every command,
the editing rules, the JSON shapes and the exit codes. `netink help dsl`
prints a one-screen summary of the DSL grammar. Any other topic is a usage
error, exit 2.

```console
$ netink help network # exit 2
```

### `netink completion`

```text
netink completion >> ~/.zshrc
netink completion >> ~/.bashrc
```

Prints a shell completion script for zsh or bash, picked from `$SHELL`.
Append it to your shell's startup file and open a new shell. It completes
commands, nouns, verbs and flags, and the ids and VLAN names found in the
`--file` being edited.

## Editing the file

Every statement in the DSL has an editing command. They all have the same
shape:

```text
netink <noun> add|set|rm <key...> [flags]
```

- The **noun** is the statement: `vlan`, `device`, `link`, `ports`. The
  sections below cover each one.
- `add` writes a new line. It fails if the statement exists already.
- `set` changes an existing line. Flags you give replace their values; the
  others stay. `--no-<flag>` removes an optional value: `--no-label`.
- `rm` deletes the line.
- The **key** is what identifies the line: a VLAN's name, a device's id, a
  link's two ends.

Statements inside a device block (`wan`, `router`, `bridge`, `ports`,
`vlan-iface`, `radio`, `address`, `lease`) take the parent first: the
device id, or `device/bridge` for a line inside a bridge. A list is one
comma-separated argument: `ether2,ether3`. A value that starts with `-`
goes after `--flag=`, or after `--` for positionals:
`netink note add gw -- '-> uplink'`.

An edit changes one line and keeps the rest of the file, comments and
blank lines included. It prints the line it wrote (nothing for `rm`), then
runs `check` and prints its diagnostics on stderr. A written edit exits 0
even when the file has errors, so you can build a network in any order; a
refused edit (an unknown key, an `add` of something that exists) exits 1
and changes nothing. `netink <noun> --help` lists a noun's verbs and flags.

### Placing and choosing

These flags work with every noun:

- `--after <key>`, `--before <key>`: put a new line right after or before
  another statement of the same kind, named by its key. Without them, a new
  line goes at the end of the file, or at the end of its block.
- `--select-text <s>`: when several lines match the key (two notes on one
  box), pick the one whose text contains `s`. Without it, an ambiguous
  `set` or `rm` exits 1 and lists the candidates.

### A walk-through

The sections below build the bakery from the top of this page again, one
command at a time, in `./network.net`. Each shows the line its command
writes, and `netink show` where it helps to see the result. Each section
names the DSL statement it writes; [the DSL reference](dsl.md) explains
what it draws.

```console
$ netink init
```

### `netink title`

```text
netink title add|set|rm [text]
```

Writes `title "text"`, the diagram's heading. `set` and `rm` act on the
last `title` line, the one the drawing uses. Takes the common `--after`,
`--before` and `--select-text`.

```console
$ netink title add "Corner Bakery"
title "Corner Bakery"
```

### `netink subtitle`

```text
netink subtitle add|set|rm [text]
```

Writes `subtitle "text"`, the smaller line under the title. Takes the
common `--after`, `--before` and `--select-text`.

```console
$ netink subtitle add "Shop floor"
subtitle "Shop floor"
```

### `netink vlan`

```text
netink vlan add|set|rm <name> [ids] [--color c] [--subnet a,b]
```

Writes `vlan <name> <ids> [color <c>] [subnet <cidr>, ...]`. `ids` is a tag
number, a comma-separated list of them, or `untagged`.

- `--color <c>`: the lane colour, a name (see `netink help dsl`) or a hex
  value such as `#ff8800`, which netink writes quoted.
- `--subnet <a,b>`: the VLAN's subnets.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink vlan add guest 20 --color blue --subnet 10.20.0.0/24
vlan guest 20 color blue subnet 10.20.0.0/24
$ netink vlan add staff untagged --color green --subnet 192.168.10.0/24 --before guest
vlan staff untagged color green subnet 192.168.10.0/24
$ netink show vlans
staff: untagged  green  192.168.10.0/24
guest: 20  blue  10.20.0.0/24
```

### `netink trunk`

```text
netink trunk add|set|rm <name> [--vlans a,b]
```

Writes `trunk <name> vlans <vlan>, ...`, a named set of VLANs that a link
can carry as one bar.

- `--vlans <a,b>`: the VLANs in the set.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink trunk add shop --vlans staff,guest
trunk shop vlans staff, guest
$ netink show trunks
shop: staff, guest
$ netink trunk rm shop
```

### `netink cloud`

```text
netink cloud add|set|rm <id> [--label v]
```

Writes `cloud <id> ["label"]`, something outside your network.

- `--label <v>`: the text in the cloud.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink cloud add internet --label Internet
cloud internet "Internet"
```

### `netink device`

```text
netink device add|set|rm <id> [--label v] [--kind v] [--model v] [--os v] [--note v]
```

Writes `device <id> ["label"] [kind <role>] [model "m"] [os "o"] [note "n"]`.
The editing commands below fill in its block.

- `--label`, `--kind`, `--model`, `--os`, `--note`: the optional parts of
  the line.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink device add gw --model "Edge 5"
device gw model "Edge 5"
$ netink device add ap --label "Ceiling AP" --model "U6 Lite"
device ap "Ceiling AP" model "U6 Lite"
$ netink device set ap --no-model
device ap "Ceiling AP"
```

`rm` refuses while other lines still name the device, and lists them.

### `netink wan`

```text
netink wan add|set|rm <parent> <iface> [--on i] [--vlan n] [--route r] [--distance n] [--dhcp] [--dhcp-address a] [--nat]
```

Writes `  wan <iface> [on <parent> vlan <n>] [route "r"] [distance <n>] [dhcp [<addr>]] [nat]`
in the device's block.

- `--on <i>`, `--vlan <n>`: the WAN runs over VLAN `n` on interface `i`.
- `--route <r>`, `--distance <n>`: the default route's name and preference.
- `--dhcp`: the address comes from the provider; `--dhcp-address <a>` also
  shows the address it got.
- `--nat`: this interface leads to the internet through address translation.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink wan add gw ether1 --dhcp --nat
  wan ether1 dhcp nat
```

### `netink router`

```text
netink router add|rm <parent>
```

Writes `  router`, the routing box with its arrows. Takes the common
`--after`, `--before` and `--select-text`.

```console
$ netink router add gw
  router
```

### `netink bridge`

```text
netink bridge add|set|rm <device> <name> [--address a,b] [--lan] [--guest] [--hotspot] [--filtering]
```

Writes `  bridge <name> [address <cidr>, ...] [lan] [guest] [hotspot] [filtering]`.

- `--address <a,b>`: the bridge's own addresses.
- `--lan`, `--guest`, `--hotspot`: the main LAN, a guest network, a guest
  network behind a captive portal.
- `--filtering`: a VLAN-aware bridge.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink bridge add gw lan --address 192.168.10.1/24 --lan
  bridge lan address 192.168.10.1/24 lan
$ netink bridge add ap br
  bridge br
```

### `netink ports`

```text
netink ports add|set|rm <parent> <names> [--untagged v] [--tagged a,b] [--horizon n]
```

Writes `ports <port>, ... [untagged <vlan>] [tagged <vlan>, ...] [horizon <n>]`,
under the bridge when the parent is `device/bridge`, otherwise directly in
the device's block.

- `--untagged <v>`, `--tagged <a,b>`: the VLANs the ports carry.
- `--horizon <n>`: recorded, not drawn.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink ports add gw/lan ether2,ether3
    ports ether2, ether3
$ netink ports add ap/br eth0,eth1
    ports eth0, eth1
```

### `netink vlan-iface`

```text
netink vlan-iface add|set|rm <parent> <name> --vlan n [--on i] [--address a,b] [--lan] [--guest] [--hotspot]
```

Writes `vlan-iface <name> [on <parent>] vlan <n> [address <cidr>, ...] [lan] [guest] [hotspot]`.

- `--vlan <n>`: the tag; required for `add`.
- `--on <i>`: the interface or bridge it sits on.
- `--address`, `--lan`, `--guest`, `--hotspot`: as for `bridge`.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink vlan-iface add gw vlan20 --on lan --vlan 20 --address 10.20.0.1/24 --guest
  vlan-iface vlan20 on lan vlan 20 address 10.20.0.1/24 guest
```

### `netink radio`

```text
netink radio add|set|rm <parent> <ifaces> [--tag n] [--ssid a,b]
```

Writes `radio <if>, ... [tag <n>] [ssid <s>, ...]`, a Wi-Fi interface.

- `--tag <n>`: the VLAN its clients land in.
- `--ssid <a,b>`: the network names it broadcasts, split at commas.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink radio add ap/br wlan0 --ssid BakeryStaff
    radio wlan0 ssid BakeryStaff
$ netink radio add ap/br wlan0-guest --tag 20 --ssid BakeryGuest
    radio wlan0-guest tag 20 ssid BakeryGuest
$ netink show ap --all
ap (device) Ceiling AP
  ap/br (group) br
    ap/eth0 (port) eth0
    ap/eth1 (port) eth1
    ap/radio-br (radio) wlan0  [BakeryStaff]
    ap/radio-br-tag20 (radio) wlan0-guest · use-tag 20  [BakeryGuest]
```

### `netink address`

```text
netink address add|set|rm <parent> <iface> <cidrs> [--lan] [--guest] [--hotspot]
```

Writes `  address <if> <cidr>, ... [lan] [guest] [hotspot]`, an address on
an interface that is not a bridge or VLAN interface.

- `--lan`, `--guest`, `--hotspot`: as for `bridge`.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink address add gw ether5 192.168.88.1/24
  address ether5 192.168.88.1/24
$ netink address rm gw ether5
```

### `netink lease`

```text
netink lease add|set|rm <parent> <address> [comment]
```

Writes `  lease <addr> ["comment"]`, an address the router hands out. A
client that names the address takes its label from the comment. Takes the
common `--after`, `--before` and `--select-text`.

```console
$ netink lease add gw 192.168.10.50 "Till printer"
  lease 192.168.10.50 "Till printer"
```

### `netink allow`

```text
netink allow add|set|rm <from> <to> [--label text] [--in <device>]
```

Writes `allow <a> -> <b> ["label"]`, a dotted "firewall allows" arrow. With
`--in <device>` it writes the same line inside that device's block, where
the ends may be the device's own interface names.

- `--label <text>`: the arrow's label.
- `--in <device>`: edit the line in that device's block instead of the
  top-level one.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink allow add vlan20 192.168.10.50 --in gw --label "guests may print"
  allow vlan20 -> 192.168.10.50 "guests may print"
```

### `netink client`

```text
netink client add|set|rm <id> [--label v] [--note v] [--lease v]
```

Writes `client <id> ["label"] [lease <ip>] [note "n"]`, an end device.

- `--label`, `--note`: its text.
- `--lease <ip>`: the address a router's `lease` line gives it.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink client add laptop --label "Office laptop"
client laptop "Office laptop"
$ netink client add till --lease 192.168.10.50
client till lease 192.168.10.50
$ netink show till
till (client) Till printer  [192.168.10.50]
```

### `netink link`

```text
netink link add|set|rm <a> <b> [--vlans a,b | --trunk name] [--label text]
```

Writes `link <a> -- <b> [vlans <name>, ... | trunk <name>] [label "l"]`, a
cable. An end is an id or `id.port`.

- `--vlans <a,b>`: the VLANs it carries, instead of the ones netink infers.
- `--trunk <name>`: carry a named trunk set, drawn as one bar.
- `--label <text>`: text on the cable.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink link add internet gw.ether1
link internet -- gw.ether1
$ netink link add gw.ether2 ap.eth0
link gw.ether2 -- ap.eth0
$ netink link add gw.ether3 laptop
link gw.ether3 -- laptop
$ netink link add ap.wlan0 till
link ap.wlan0 -- till
$ netink show gw/ether2--ap/eth0
{
  "id": "gw/ether2--ap/eth0",
  "from": "gw/ether2",
  "to": "ap/eth0",
  "lanes": [
    "staff",
    "guest"
  ],
  "line": 22
}
```

### `netink note`

```text
netink note add|set|rm <target> [text]
```

Writes `note <target> "text"`, a line of text under a box. One box may have
several notes, so `set` and `rm` take `--select-text` to say which. Also
takes the common `--after` and `--before`.

```console
$ netink note add ap "above the counter"
note ap "above the counter"
$ netink note add ap "replace in spring"
note ap "replace in spring"
$ netink note rm ap # exit 1
$ netink note rm ap --select-text spring
$ netink show ap
ap (device) Ceiling AP  [above the counter]
  ap/br (group) br
    ap/eth0 (port) eth0
    ap/radio-br (radio) wlan0  [BakeryStaff]
    ap/radio-br-tag20 (radio) wlan0-guest · use-tag 20  [BakeryGuest]
```

### `netink place`

```text
netink place add|set|rm <a> [--near <b>]
```

Writes `place <a> near <b>`, a layout hint.

- `--near <b>`: the box to put `a` next to.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink place add laptop --near gw
place laptop near gw
$ netink place rm laptop
```

### `netink row`

```text
netink row add <ids...> | row set <first-id> <new ids...> | row rm <first-id>
```

Writes `row <a>, <b>, ...`, a hint to put boxes side by side. The key is
the row's first id. Takes the common `--after`, `--before` and
`--select-text`.

```console
$ netink row add laptop till
row laptop, till
$ netink row rm laptop
```

### `netink side`

```text
netink side add|set|rm <device> <group> [top|bottom|left|right]
```

Writes `<device>.side <group> = <side>`, which edge of a device box a group
of ports sits on. Takes the common `--after`, `--before` and
`--select-text`.

```console
$ netink side add gw lan bottom
gw.side lan = bottom
$ netink side rm gw lan
```

### `netink legend`

```text
netink legend set --mode auto|off | --position bottom|right
netink legend rm mode|position
```

Writes `legend auto`, `legend off` or `legend position bottom|right`.

- `--mode auto|off`: show or hide the legend.
- `--position bottom|right`: where it goes.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink legend set --position right
legend position right
```

### `netink legend entry`

```text
netink legend entry add|rm <style> <text>
```

Writes `legend add <style> "text"`, an extra legend entry whose line sample
is a VLAN name or `wire`, `trunk`, `route`, `allow`. Takes the common
`--after`, `--before` and `--select-text`.

```console
$ netink legend entry add staff "tills and office"
legend add staff "tills and office"
```

### `netink legend hide`

```text
netink legend hide add|rm <entry>
```

Writes `legend remove <entry>`, which drops an automatic entry. Takes the
common `--after`, `--before` and `--select-text`.

```console
$ netink legend hide add wire
legend remove "wire"
```

### `netink legend note`

```text
netink legend note add|rm <text>
```

Writes `legend note "text"`, a footnote under the legend. Takes the common
`--after`, `--before` and `--select-text`.

```console
$ netink legend note add "Drawn from the spring inventory."
legend note "Drawn from the spring inventory."
```

### `netink style`

```text
netink style add|set|rm jumps [arc|gap|none]
```

Writes `style jumps arc|gap|none`, how crossing cables are drawn. Takes the
common `--after`, `--before` and `--select-text`.

```console
$ netink style add jumps gap
style jumps gap
```

### `netink route`

```text
netink route add|set|rm <from> <to> [--label text]
```

Writes `route <a> -> <b> ["label"]`, a routing arrow netink cannot infer,
such as a VPN.

- `--label <text>`: the arrow's label.
- And the common `--after`, `--before`, `--select-text`.

```console
$ netink route add laptop internet --label "web"
route laptop -> internet "web"
$ netink route rm laptop internet
```

### `netink hide`

```text
netink hide add|rm <target>
```

Writes `hide <target>`, which removes one arrow by its id, or every arrow
touching a box. Takes the common `--after`, `--before` and `--select-text`.

```console
$ netink hide add route:gw/router->gw/lan
hide route:gw/router->gw/lan
$ netink hide rm route:gw/router->gw/lan
```

The walk-through is done. `network.net` now holds the bakery, and it draws:

```console
$ netink check
$ netink render -o network.svg
```

## JSON output

With `--json`, every command that reads or edits a file prints exactly one
JSON document on stdout, on success and on failure, and nothing else.
`--version`, `help` and `completion` print their usual text.

| Command | Shape |
|---|---|
| `render` | `{ok, output, width, height, warnings}`, plus `svg` when there is no `-o`; refused: `{ok: false, diags}` |
| `check` | `{ok, diags}` |
| `show` | the model objects themselves |
| `import` | `{ok, stmt, diags}` |
| editing | `{ok, file, line, text, diags}`: the line number and text written |
| any failure | `{error, file, line, hint?}`; a refused edit adds `candidates` when the key is ambiguous |

A diagnostic is `{level, file, line, message, hint?}`, where `level` is
`"error"` or `"warning"`.

```console
$ netink check --file broken.net --json # exit 1
{"ok":false,"diags":[{"level":"error","file":"broken.net","line":3,"message":"unknown vlan \"office\"","hint":"declare it with vlan office <ids>"}]}
$ netink vlan set guest --color blue --json
{"ok":true,"file":"./network.net","line":4,"text":"vlan guest 20 color blue subnet 10.20.0.0/24","diags":[]}
$ netink note add ap "second note"
note ap "second note"
$ netink note rm ap --json # exit 1
{"error":"2 statements match note ap","file":"./network.net","line":0,"hint":"narrow it with --select-text","candidates":[{"line":25,"text":"note ap \"above the counter\""},{"line":31,"text":"note ap \"second note\""}]}
$ netink note rm ap --select-text second
```

## Exit codes

- `0`: success. For `check` and `render`, warnings still exit 0. An edit
  that was written exits 0 even if `check` then reports errors.
- `1`: the file has errors, an edit was refused, a file could not be read
  or written, or something else went wrong at run time.
- `2`: a usage error: an unknown command or flag, or a missing argument.

No command ever prompts, so netink is safe to run from scripts.

```console
$ netink frobnicate --json # exit 2
{"error":"unknown command frobnicate","file":"","line":0,"hint":"run netink --help"}
```

## Known limitations

- `--after` and `--before` only place a line next to a statement of the
  same kind: `netink vlan add ... --after gw` does not work, because `gw` is
  a device.
- `render --path a b` keeps only the shortest paths between `a` and `b`; a
  longer, redundant path is left out.
- A lease comment can't be cleared from the command line: `netink lease set`
  needs a new comment. Delete it in the file by hand.
- An SSID containing a comma can't be given through `--ssid`, which splits
  its value at commas. Write `ssid "Upstairs, east"` in the file instead.
