# The netink language

netink draws a network diagram from a plain text file, usually called
`network.net`. You describe what exists: the internet uplink, routers,
switches, access points, the cables between them and the VLANs they carry.
netink works out the layout, the coloured VLAN lanes along each cable and the
routing arrows, and writes an SVG.

This page teaches the language. It starts with a small network that grows one
step at a time, then explains each statement in turn, then the rules netink
uses to fill in what you did not write.

Two commands are enough to follow along:

- `netink check` reads `./network.net` and reports mistakes with their line
  numbers. It prints nothing when the file is fine.
- `netink render -o network.svg` draws the file.

Every example on this page is run by netink's test suite, so they all work as
written. `netink help dsl` prints a one-screen summary of the grammar once you
know your way around.

## A worked example: a small café

The café has an internet line, a router, a switch in the back office, a
ceiling access point with a staff and a guest Wi-Fi, a laptop and a till
printer. We build it in five steps.

### Step 1: the router and the internet

```net
title "Harbour Cafe"

cloud internet "Internet"

device gw model "Edge 5"
  wan ether1 dhcp nat
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2, ether3

link internet -- gw.ether1
```

- `cloud` draws a cloud: something outside your network.
- `device gw` is the router. The indented lines under it describe its
  insides: `ether1` is the internet-facing (WAN) port, `router` adds the
  routing box, and the bridge `lan` holds ports `ether2` and `ether3` and the
  address `192.168.10.1/24`.
- `link` draws a cable. `gw.ether1` means port `ether1` of device `gw`.

Since `gw` has no label of its own, netink makes one from its id, model and
LAN address: `GW · Edge 5 · 192.168.10.1`.

### Step 2: a switch and a laptop

```net
title "Harbour Cafe"

cloud internet "Internet"

device gw model "Edge 5"
  wan ether1 dhcp nat
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2, ether3

device sw "Back-office switch"
  bridge br
    ports p1, p2, p3, p4

client laptop "Office laptop"

link internet -- gw.ether1
link gw.ether2 -- sw.p1
link sw.p3 -- laptop
```

A `client` is an end device: a laptop, a printer, a camera. Clients have no
ports, so a link names just the client.

`netink show links` lists the cables and what each one carries. There are no
VLANs yet, so every cable is a plain wire:

```console
$ netink show links
internet--gw/ether1: internet -- gw/ether1  lanes: wire
gw/ether2--sw/p1: gw/ether2 -- sw/p1  lanes: wire
sw/p3--laptop: sw/p3 -- laptop  lanes: wire
```

### Step 3: VLANs

The staff network is untagged; guests get VLAN 20, which the router serves
on its own VLAN interface.

```net
title "Harbour Cafe"

vlan staff untagged color green subnet 192.168.10.0/24
vlan guest 20       color blue  subnet 10.20.0.0/24

cloud internet "Internet"

device gw model "Edge 5"
  wan ether1 dhcp nat
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2, ether3
  vlan-iface vlan20 on lan vlan 20 address 10.20.0.1/24 guest

device sw "Back-office switch"
  bridge br
    ports p1, p2, p3, p4

client laptop "Office laptop"

link internet -- gw.ether1
link gw.ether2 -- sw.p1
link sw.p3 -- laptop
```

```console
$ netink show links
internet--gw/ether1: internet -- gw/ether1  lanes: wire
gw/ether2--sw/p1: gw/ether2 -- sw/p1  lanes: staff
sw/p3--laptop: sw/p3 -- laptop  lanes: staff
```

The staff VLAN now runs from the router to the laptop. The guest VLAN stays
inside the router: nothing behind the switch uses VLAN 20 yet, so netink does
not draw it on the cable to the switch, and `netink check` warns that `guest`
is carried by no link. You never list a cable's VLANs by hand
unless you want to; see [VLAN lanes](#vlan-lanes).

### Step 4: an access point with two Wi-Fi networks

```net
title "Harbour Cafe"

vlan staff untagged color green subnet 192.168.10.0/24
vlan guest 20       color blue  subnet 10.20.0.0/24

cloud internet "Internet"

device gw model "Edge 5"
  wan ether1 dhcp nat
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2, ether3
  vlan-iface vlan20 on lan vlan 20 address 10.20.0.1/24 guest

device sw "Back-office switch"
  bridge br
    ports p1, p2, p3, p4

device ap "Ceiling AP"
  bridge br
    ports eth0
    radio wlan0 ssid CafeStaff
    radio wlan0-guest tag 20 ssid CafeGuest

client laptop "Office laptop"

link internet -- gw.ether1
link gw.ether2 -- sw.p1
link sw.p2 -- ap.eth0
link sw.p3 -- laptop
```

The access point's guest radio tags its traffic with VLAN 20, so now there is
something on each side of the switch that uses VLAN 20, and the guest lane
appears on both cables:

```console
$ netink show links
internet--gw/ether1: internet -- gw/ether1  lanes: wire
gw/ether2--sw/p1: gw/ether2 -- sw/p1  lanes: staff, guest
sw/p2--ap/eth0: sw/p2 -- ap/eth0  lanes: staff, guest
sw/p3--laptop: sw/p3 -- laptop  lanes: staff
gw/ether2--gw/vlan20: gw/vlan20 -- gw/ether2  lanes: guest
ap/eth0--ap/radio-br: ap/eth0 -- ap/radio-br  lanes: staff
ap/eth0--ap/radio-br-tag20: ap/eth0 -- ap/radio-br-tag20  lanes: guest
```

### Step 5: the till printer and a firewall rule

The router hands the till printer a fixed address. Guests may print to it.

```net
title "Harbour Cafe"
subtitle "Ground floor"

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

device sw "Back-office switch"
  bridge br
    ports p1, p2, p3, p4

device ap "Ceiling AP"
  bridge br
    ports eth0
    radio wlan0 ssid CafeStaff
    radio wlan0-guest tag 20 ssid CafeGuest

client laptop "Office laptop"
client till lease 192.168.10.50

link internet -- gw.ether1
link gw.ether2 -- sw.p1
link sw.p2 -- ap.eth0
link sw.p3 -- laptop
link ap.wlan0 -- till

note sw "under the counter"
```

- `lease` records the address the router gives out. On its own it draws
  nothing; `client till lease 192.168.10.50` draws the printer and takes its
  label, "Till printer", from the lease.
- `allow` inside the router's block draws a dotted firewall arrow from the
  guest VLAN interface to the printer.
- `note` adds a line of text under a box.

```console
$ netink check
$ netink render -o cafe.svg
```

Open `cafe.svg` in a browser. The router box shows its WAN port, the routing
box with arrows to the internet and to each network it serves, and the
bridge; the green staff lane and the dashed blue guest lane run side by side
down to the access point; a legend at the bottom explains the colours.

## File basics

### Lines and comments

One statement per line. `#` starts a comment that runs to the end of the
line, except inside quotes. Blank lines are ignored.

```net
# a comment on its own line
cloud internet "Internet #1"   # the # inside quotes is text
```

### Quoting

Labels and other free text go in double quotes. Inside quotes, write `\"`
for a quote and `\\` for a backslash.

```net
device sw
device nas "Storage \"vault\""
link sw -- nas
```

### Continuation lines

A line that ends with a comma continues on the next line, so long lists can
wrap:

```net
cloud internet
device sw
client cam1
client cam2
client cam3
link sw -- cam1,
           cam2, cam3
link internet -- sw
```

### Ids

Every cloud, device and client has an id made of lowercase letters, digits,
`_` and `-`: `gw`, `office-switch`, `cam_2`. Ids are what you use to refer
to things; the label (the quoted text) is what is drawn.

Inside a device block, interfaces have their own short names, local to that
device (`ether2`, not `gw.ether2`). Names may be quoted when they contain
other characters, like `"ge-0/0/0"`. From outside the block you refer to an
interface as `<device>.<name>`: `gw.ether2`.

In `netink show` output and in arrow ids, the same interface appears as a
child id `<device>/<name>`: `gw/ether2`. A `/` inside a name is written
`%2F` there (`sw/ge-0%2F0%2F0`).

### Indentation

Device blocks are indented by exactly two spaces per level; tabs are an
error. Level one sits under a `device` line; level two sits under a `bridge`
line and holds that bridge's `ports`, `vlan-iface` and `radio` lines.

## Top-level statements

These lines start in column one.

### `title` and `subtitle`

```text
title "text"
subtitle "text"
```

The heading and the smaller line under it. If a file has several, the last
one wins.

```net
title "Harbour Cafe"
subtitle "Ground floor, as of spring"
```

### `vlan`

```text
vlan <name> untagged          [color <c>] [subnet <cidr>(, <cidr>)*]
vlan <name> <id>(, <id>)*     [color <c>] [subnet <cidr>(, <cidr>)*]
```

Defines a VLAN: its name, its tag numbers (or `untagged` for the network
that travels without a tag) and how it is drawn.

- `color`: one of the theme colours `green`, `blue`, `orange`, `red`,
  `purple`, `teal`, `brown`, `pink`, `grey` (or `gray`), `amber`, `indigo`,
  `cyan`, or any colour as a quoted hex value, `"#7b1fa2"`. The quotes are
  needed because `#` would otherwise start a comment. Without `color`, netink
  picks a distinct colour and dash pattern for each VLAN.
- `subnet`: one or more IPv4 or IPv6 prefixes, shown in the legend. `check`
  warns about an interface address outside its VLAN's subnets.
- One VLAN may cover several tag numbers (`guest 20, 21`); the legend shows
  them together.

```net
vlan office  untagged color green
vlan guest   20, 21   color blue   subnet 10.20.0.0/24, 2001:db8:20::/64
vlan cameras 30       color "#7b1fa2"
device core
device sw
link core -- sw vlans office, guest, cameras
```

The older form `vlan office untagged "192.168.10.0/24"`, a bare quoted
subnet without the word `subnet`, still works.

### `trunk`

```text
trunk <name> vlans <vlan>(, <vlan>)*
```

Names a set of VLANs that often travel together. A link that says
`trunk <name>` carries exactly those VLANs and is drawn as one thick bar
labelled with the set's name, which keeps busy uplinks readable.

```net
vlan office 10
vlan voice  11
vlan guest  20
trunk uplink vlans office, voice, guest

device core
device floor2
link core -- floor2 trunk uplink
```

### `cloud`

```text
cloud <id> ["label"]
```

Something outside your network, drawn as a cloud: the internet, a mobile
network, a partner's VPN. Clouds sit at the top of the picture.

```net
cloud internet "Internet"
cloud mobile "Mobile network"
device gw
link internet -- gw
link mobile -- gw
```

### `device`

```text
device <id> ["label"] [kind <role>] [model "m"] [os "o"] [note "n"]
  <block lines>
```

A box: a router, switch, access point, modem, server. Options:

- `"label"`: the text in the box's header. Without it, netink builds one
  from the id in capitals, the model, the first IPv4 address on a `lan`
  interface and the OS, joined by ` · `.
- `kind`: a one-word role such as `switch` or `modem`. It is recorded but
  does not change the drawing yet.
- `model`, `os`: hardware model and software version, used in the computed
  label.
- `note`: an extra line of text under the header.

A device may have indented [block lines](#device-blocks) describing its
ports, bridges, radios and addresses. A device without them is a plain box
that cables attach to as a whole.

```net
cloud internet
device modem "ISP modem" kind modem note "rented from the ISP"
device gw model "Edge 5" os "EdgeOS 3.1"
  wan ether1 dhcp
  router
link internet -- modem -- gw.ether1
```

A second `device` line for an id that already has a block (or that comes
from `imports`) without block lines of its own only sets that device's label
and note.

### `client`

```text
client <id> ["label"] [lease <ip>] [note "n"]
```

An end device: laptop, phone, printer, camera. Drawn as a small box with no
ports.

- `lease <ip>`: the address it gets from a DHCP server. If a device's block
  has a `lease` line for that address, the client's label defaults to that
  lease's comment. The address is shown under the label. See
  [lease opt-in](#leases-are-opt-in).
- `note`: an extra line under the label.

```net
device sw
client printer "Back-office printer" lease 192.168.10.60 note "toner in the drawer"
link sw -- printer
```

### `link`

```text
link <end> (-- <end>)+ [vlans <vlan>(, <vlan>)* | trunk <name>] [label "text"]
<end> = <id> | <id>.<interface>
```

A cable. Each end is a cloud, client or device id, or a device's interface
as `<device>.<interface>`.

- A chain `link a -- b -- c` draws two cables, `a`–`b` and `b`–`c`.
- A comma list after the last `--` fans out: `link sw -- cam1, cam2` draws
  `sw`–`cam1` and `sw`–`cam2`.
- `vlans`: the VLANs this cable carries, overriding what netink would infer.
  `trunk`: the same, using a named [`trunk`](#trunk) set. A link takes one or
  the other, not both.
- `label`: text drawn along the cable. In a chain it goes on the last cable
  only; in a fan-out every cable gets it. See [chain labels](#chain-labels).

When an end names a device that has a block but no interface, netink uses
that device's only unlinked port, and reports an error if there is not
exactly one.

```net
vlan cameras 30
cloud internet
device modem
device sw
client cam1
client cam2
link internet -- modem -- sw label "fibre"
link sw -- cam1, cam2 vlans cameras
```

### `note`

```text
note <target> "text"
```

Adds a line of text under a box. The target is an id, or a device's
interface as `<device>.<interface>`.

```net
device gw
  wan ether1
  router
cloud internet
link internet -- gw.ether1
note gw.ether1 "500/50 fibre"
note internet "provider: an example ISP"
```

### `place`

```text
place <a> near <b>
```

A layout hint: try to put `a` close to `b`. Hints are best effort; see
[known limitations](#known-limitations).

```net
cloud internet
cloud mobile
device gw
device backup
link internet -- gw
link mobile -- backup
place backup near gw
```

### `row`

```text
row <a>(, <b>)+
```

A layout hint: try to keep these boxes side by side in one row.

```net
device sw
device ap1
device ap2
link sw -- ap1, ap2
row ap1, ap2
```

### `<device>.side`

```text
<device>.side <group> = top|bottom|left|right
```

A layout hint: try to put one of a device's groups (its `wan` group or one of
its bridges) on the given side of the device box.

```net
cloud internet
device gw
  wan ether1
  router
  bridge lan
    ports ether2
link internet -- gw.ether1
gw.side wan = top
```

### `legend`

```text
legend auto | legend off
legend add <style> "text"
legend remove <entry>
legend note "text"
legend position bottom|right
```

The legend is built automatically from what the picture uses: one entry per
VLAN that is drawn, plus one per kind of line (plain cable, trunk bar,
routed arrow, firewall arrow).

- `legend off` hides it; `legend auto` (the default) shows it.
- `legend add <style> "text"`: an extra entry. `<style>` is a VLAN name or
  one of `wire`, `trunk`, `route`, `allow`, and decides the line sample.
- `legend remove <entry>`: drops an automatic entry, by VLAN name, by line
  kind (`wire`, `trunk`, `route`, `allow`) or by its exact text.
- `legend note "text"`: a footnote under the legend.
- `legend position bottom|right`: where it goes (default `bottom`).

```net
vlan office untagged color green
device sw
client pc
link sw -- pc vlans office
legend remove wire
legend add office "office desks"
legend note "Drawn from the spring inventory."
legend position right
```

### `style`

```text
style jumps arc|gap|none
```

How a cable is drawn where it crosses another: a small hop (`arc`, the
default), a short break (`gap`), or a plain crossing (`none`).

```net
style jumps gap
```

### `route`

```text
route <a> -> <b> ["label"]
```

Draws a purple double-headed routing arrow between two things that can reach
each other. Ends are ids, `<device>.<interface>`, or an IPv4 address that a
client leases. Routers with a `router` line already get their arrows
automatically (see [routing arrows](#routing-arrows)); `route` is for what
netink cannot know, such as a VPN.

```net
cloud internet
device office
device shop
link internet -- office, shop
route office -> shop "site-to-site VPN"
```

### `allow`

```text
allow <a> -> <b> ["label"]
```

Draws a dotted one-way "firewall allows" arrow from `a` to `b`. Ends are as
for `route`. For a rule that belongs to a router, the `allow` block line
inside its device block reads more naturally.

```net
device gw
client nas
client guestphone
link gw -- nas, guestphone
allow guestphone -> nas "may back up photos"
```

### `hide`

```text
hide <arrow-id> | hide <id>
```

Removes routing and firewall arrows from the picture: one arrow by its id,
or every arrow touching a box. An arrow id is
`<route|allow>:<from>-><to>` with child ids, for example
`route:gw/router->gw/lan`; `netink show <arrow-id>` prints one. `hide` does
not remove boxes or cables.

```net
cloud internet
device gw
  wan ether1 nat
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2
link internet -- gw.ether1
hide route:gw/router->gw/lan
```

### `imports`

```text
imports rsc <path> as <id> (, <path> as <id>)*
```

Reads a MikroTik RouterOS configuration export (`/export` output) and turns
it into a device with the given id, as if you had written its block by hand:
WAN ports, router, bridges, ports, VLAN interfaces, radios, addresses,
leases and firewall `allow` rules. Paths are relative to the `.net` file.
The export is read again on every run, so the diagram follows the router's
configuration.

Say this export is saved next to `network.net` as `edge.rsc`:

```rsc file=edge.rsc
/system identity set name=edge
/interface bridge add name=bridge
/interface bridge port add bridge=bridge interface=ether2
/interface bridge port add bridge=bridge interface=ether3
/ip address add address=192.168.30.1/24 interface=bridge
/interface list add name=WAN
/interface list member add list=WAN interface=ether1
/ip dhcp-client add interface=ether1
/ip firewall nat add chain=srcnat action=masquerade out-interface-list=WAN
```

```net
imports rsc edge.rsc as edge
cloud internet
device edge "Edge router"
link internet -- edge.ether1
```

The `device edge "Edge router"` line only sets the label; an imported device
cannot also have a hand-written block. To stop importing and keep the
result as text, `netink import` prints the block the export turns into:

```console
$ netink import edge.rsc --as edge
device edge
  wan ether1 dhcp nat
  router
  bridge bridge address 192.168.30.1/24
    ports ether2, ether3
```

## Device blocks

The indented lines under a `device` describe what is inside it. Two spaces
per level. Level-one lines sit directly under the device; `ports`,
`vlan-iface` and `radio` lines may also sit one level deeper, under a
`bridge`, which makes them members of that bridge.

### `wan`

```text
wan <interface> [on <parent> vlan <n>] [route "name"] [distance <n>] [dhcp [<addr>]] [nat]
```

An internet-facing interface, drawn in the device's red WAN group, in the
order written.

- `on <parent> vlan <n>`: the WAN runs over VLAN `n` on another interface.
- `route "name"`, `distance <n>`: the default route that uses this
  interface and its preference (lower wins). Shown under the port.
- `dhcp`: the address comes from the provider; `dhcp 203.0.113.7` shows the
  address it got.
- `nat`: this interface leads to the internet with address translation,
  even without a `route`.

With a `router` line, each WAN interface that has a route or `nat` gets a
routing arrow to the router; the single best one (lowest distance) is
labelled "to internet".

```net
vlan backup 60
device gw
  wan ether1 route "main" distance 1 dhcp nat
  wan lte1 on lan vlan 60 route "backup" distance 2 nat
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2
cloud internet
cloud mobile
link internet -- gw.ether1
link mobile -- gw.ether2
```

### `router`

```text
router
```

Adds the "routing · firewall" box (with "NAT" when a WAN interface has
`nat`) and the automatic [routing arrows](#routing-arrows). A device without
it is treated as a switch or access point.

```net
cloud internet
device gw
  wan ether1 nat
  router
link internet -- gw.ether1
```

### `bridge`

```text
bridge <name> [address <cidr>(, <cidr>)*] [lan] [guest] [hotspot] [filtering]
```

A group of ports switched together, drawn as a coloured box inside the
device. Its `ports`, `vlan-iface` and `radio` members are indented under it.

- `address`: the bridge's own addresses, IPv4 or IPv6. The first IPv4 one is
  shown in the bridge's header, the rest under it.
- `lan`: this is the main local network; its routing arrow is labelled
  "LAN" and its address goes into the device's computed label.
- `guest`: draw it in the guest colour when no VLAN decides its colour.
- `hotspot`: guests log in through a captive portal; its routing arrow
  reads "guests, after hotspot login".
- `filtering`: a VLAN-aware bridge, which passes a tagged VLAN only between
  ports listed for it (see [VLAN lanes](#vlan-lanes)).

A bridge takes the colour of the tagged VLAN its VLAN interfaces belong to;
otherwise the guest colour for `guest`, otherwise the untagged VLAN's colour.

```net
vlan office untagged color green
device gw
  router
  bridge lan address 192.168.10.1/24, 2001:db8:10::1/64 lan
    ports ether2, ether3
  bridge guests address 10.20.0.1/24 guest hotspot
    ports ether4
device sw
link gw.ether2 -- sw
```

### `ports`

```text
ports <port>(, <port>)* [untagged <vlan>] [tagged <vlan>(, <vlan>)*] [horizon <n>]
```

Physical ports. Under a bridge they are its members; directly under the
device they stand alone. `<vlan>` is a VLAN name or a tag number.

- `untagged <vlan>`: the VLAN this port sends and receives without a tag.
- `tagged <vlan>, ...`: VLANs this port carries tagged. Each one is also
  drawn as a small `<port>.<id>` chip next to the port.
- `horizon <n>`: recorded, not drawn.

```net
vlan office untagged
vlan mgmt   99
device gw
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2
  vlan-iface vlan99 on lan vlan 99 address 10.99.0.1/24
device sw "Managed switch"
  bridge br filtering
    ports p1 tagged mgmt
    ports p2, p3
  vlan-iface mgmt on br vlan 99 address 10.99.0.2/24
client pc
link gw.ether2 -- sw.p1
link sw.p2 -- pc
```

The switch's management address lives on VLAN 99, which the uplink `p1`
carries tagged; `p1` is drawn with a `p1.99` chip.

### `vlan-iface`

```text
vlan-iface <name> [on <parent>] vlan <n> [address <cidr>(, <cidr>)*] [lan] [guest] [hotspot]
```

A VLAN interface: the device's own presence on VLAN `n`, for example where a
router serves a guest network. `on <parent>` names the port or bridge it
sits on. Under a bridge it is also a member of that bridge. Flags and
addresses work as for [`bridge`](#bridge).

VLAN interfaces are what make a tagged VLAN show up on cables: see
[VLAN lanes](#vlan-lanes).

```net
vlan guest 20 color blue
device gw
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2
  vlan-iface vlan20 on lan vlan 20 address 10.20.0.1/24 guest
device ap
  bridge br
    ports eth0
    radio wlan0-guest tag 20 ssid Guests
link gw.ether2 -- ap.eth0
```

### `radio`

```text
radio <interface>(, <interface>)* [tag <n>] [ssid <name>(, <name>)*]
```

A Wi-Fi radio chip. List the radio interfaces it covers, physical and
virtual (`wlan0, wlan0-iot`); each name can be linked to. `ssid` lists the
network names it broadcasts, quoted if they contain spaces. `tag <n>` means
its clients' traffic leaves the radio tagged with VLAN `n`.

Two `radio` lines on the same bridge with the same tag merge into one chip.

```net
vlan guest 20
device ap
  bridge br
    ports eth0
    radio wlan0, wlan1 ssid "Cafe Staff"
    radio wlan0-guest tag 20 ssid "Cafe Guest"
client tablet
link ap.wlan0 -- tablet
```

### `address`

```text
address <interface> <cidr>(, <cidr>)* [lan] [guest] [hotspot]
```

Adds addresses (IPv4 or IPv6) and flags to any interface in the block. It
may name an interface that is not drawn at all, such as a VPN tunnel; the
address is then only used by `check` and by `render --address`.

```net
device gw
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2
  address lan 2001:db8:10::1/64
  address wg0 10.99.0.1/24
device sw
link gw.ether2 -- sw
```

### `lease`

```text
lease <addr> ["comment"]
```

A fixed DHCP lease this device hands out. Leases are not drawn by
themselves; a `client ... lease <addr>` line draws one and takes its label
from the comment. `netink render --all` draws every lease.

```net
device gw
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2
  lease 192.168.10.50 "Till printer"
  lease 192.168.10.51 "Kitchen display"
client till lease 192.168.10.50
link gw.ether2 -- till
```

### `allow`

```text
allow <interface> -> <client-id-or-address> ["label"]
```

A firewall rule in this device that lets one of its interfaces reach one
client: drawn as a dotted arrow. The target is a client id or an address
that a client leases. Without a label the arrow reads
"`<interface>` may reach `<client>` (firewall)".

```net
device gw
  router
  bridge lan address 192.168.10.1/24 lan
    ports ether2
  bridge guests address 10.20.0.1/24 guest
    ports ether3
  allow guests -> printer "guests may print"
client printer lease 192.168.10.60
client visitor
link gw.ether2 -- printer
link gw.ether3 -- visitor
```

## How netink fills in the rest

### VLAN lanes

A cable is drawn as parallel lanes, one per VLAN it carries, each in its
VLAN's colour. More than four lanes become one thick trunk bar labelled with
the tag numbers; a link with a named [`trunk`](#trunk) set is always a bar
labelled with the set's name. A cable with no VLAN is a plain grey wire.

When a link has `vlans` or `trunk`, it carries exactly those. Otherwise
netink infers its VLANs from the device blocks at both ends:

- A **tagged VLAN** is carried when, starting from each end and walking away
  from this cable through bridges and other cables, you reach something that
  uses the VLAN: a `vlan-iface` with that tag on the port or its bridge, or a
  `radio ... tag` on the bridge. Both sides must lead to a user. That is why
  in the [worked example](#step-3-vlans) the guest VLAN appeared on the
  switch uplink only once the access point's guest radio existed.
- An ordinary bridge passes every VLAN between its members. A `filtering`
  bridge passes VLAN `n` only between members listed for it: ports with
  `untagged n` or `tagged n`, or with a VLAN interface for `n` on them.
- The **untagged VLAN** (`vlan <name> untagged`) is carried when each end is
  a bridge member (a port inside a bridge, or a radio) or has no block. A WAN
  port is not a bridge member, so the internet cable stays a wire.
- A cable whose two ends both lack a block is a plain wire unless it says
  `vlans` or `trunk`.

When you write `vlans` on a cable whose end has a device block, `check`
warns if your list differs from what it infers, which catches a VLAN that a
device does not actually carry.

### Ends without a block carry only untagged VLANs

An end that has no device block (a cloud, a client, or a device with no
indented lines) neither uses nor passes on tagged VLANs. A cable to it
carries only the untagged VLAN. To draw a tagged VLAN to such an end, list
it on the link:

```net
vlan office untagged
vlan cameras 30
device sw
  bridge br
    ports p1, p2
device poe "Camera switch"
client desk
client cam1
link sw.p1 -- desk
link sw.p2 -- poe
link poe -- cam1 vlans cameras
```

The cables from `sw` carry `office` only; `poe`–`cam1` carries `cameras`
because the link says so.

### Chain labels

A `label` on a chain `link a -- b -- c label "x"` belongs to the last cable,
`b`–`c`. On a fan-out `link sw -- x, y label "x"` every cable gets it. A
chain that ends in a fan-out labels only the fan-out cables.

```net
cloud internet
device modem
device gw
link internet -- modem -- gw label "fibre"
```

Here only `modem`–`gw` is labelled "fibre".

### Tiers: what goes on top

netink lays the picture out from top to bottom by tier: clouds first, then
anything between a cloud and a router (an ISP modem), then WAN interfaces,
routers, bridges and ports, then everything downstream in order of how many
cables away it is. Each cable is turned to point downwards before layout, so
a diagram reads from the internet down to the clients regardless of which
way round you wrote the `link`. There is no statement to set a tier: link
the uplink to a cloud and the rest follows.

### Leases are opt-in

A router may hand out dozens of fixed leases. They stay out of the picture
unless you ask: `client <id> lease <addr>` draws one, labelled with the
lease's comment unless the client has its own label.
`netink render --all` draws every lease. When some device lists leases,
`check` warns about a client whose lease no device has.

### Routing arrows

A device with a `router` line gets purple routing arrows inside its box,
without you writing them:

- from each WAN interface that has a route or `nat` to the router, the best
  one labelled "to internet";
- from the router to every bridge or interface that has an address, labelled
  "LAN" for `lan` and "guests, after hotspot login" for `hotspot`.

Add more with [`route`](#route) and [`allow`](#allow); remove them with
[`hide`](#hide).

### Spare and hidden ports

On a device with a `router` line, unlinked bridge ports are drawn dashed as
spare ports. On a device without one (a switch, an access point) they are
left out to keep the picture small; `netink render --all` draws them. A
`note`, hint or `allow` that names such a hidden port is an error.

## Known limitations

- A lease comment can't be cleared with the editing commands:
  `netink lease set` needs a new comment. Delete it in the file by hand.
- An SSID containing a comma can't be written with the editing commands,
  because `--ssid` splits its value at commas. In the file it works when
  quoted: `ssid "Upstairs, east"`.
- `place`, `row` and `<device>.side` hints are best effort: the layout
  engine may ignore them when they conflict with the cables.
- `kind` on a device and `horizon` on ports are recorded but do not change
  the drawing.
- `hide` removes arrows only; there is no way to hide a box or a cable.
- No command lists arrow ids; build them as
  `<route|allow>:<from>-><to>` from the child ids `netink show` prints.
- An address as a `route` or `allow` end works for IPv4 only, and an address
  that no client leases draws no arrow, without a warning.
- Ids use lowercase letters only: `Gw` is an error.
- A comment-only line right after a line ending in a comma ends the
  continuation.
