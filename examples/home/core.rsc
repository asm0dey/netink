# CORE - hAP ax3, 192.168.0.1, RouterOS 7.25.1
/interface list add name=WAN
/interface list add name=LAN
/interface list member add interface=ether1 list=WAN
/interface list member add interface=bridge list=LAN
/interface vlan add interface=bridge name=vlan60-lte vlan-id=60
/interface list member add interface=vlan60-lte list=WAN
/interface bridge add admin-mac=02:00:00:00:00:01 auto-mac=no name=bridge
/interface bridge port add bridge=bridge interface=ether3
/interface bridge port add bridge=bridge interface=ether4
/interface bridge port add bridge=bridge interface=ether2
/interface bridge port add bridge=bridge interface=ether5
/interface bridge port add bridge=bridge interface=wifi1
/interface bridge port add bridge=bridge interface=wifi2
/ip address add address=192.168.0.1/24 interface=bridge network=192.168.0.0
/ip dhcp-client add add-default-route=no interface=ether1 name=ether1 script=":if (\$bound=1) do={/ip route set [find comment=\"wan1-probe\"] gateway=\$\"gateway-address\"}" use-peer-dns=no
/ip dhcp-client add add-default-route=no interface=vlan60-lte name=client1 use-peer-dns=no
/ip route add comment=wan1-probe dst-address=9.9.9.9/32 gateway=203.0.113.254 scope=10
/ip route add check-gateway=ping comment=wan1-main dst-address=0.0.0.0/0 gateway=9.9.9.9 target-scope=11
/ip route add comment=wan2-lte distance=2 dst-address=0.0.0.0/0 gateway=192.168.88.1
/ip dhcp-server lease add address=192.168.0.28 client-id=1:2:0:0:0:0:2 comment=TV mac-address=02:00:00:00:00:02 server=defconf
/ip dhcp-server lease add address=192.168.0.101 client-id=1:2:0:0:0:0:3 comment="AP ap1" mac-address=02:00:00:00:00:03 server=defconf
/ip dhcp-server lease add address=192.168.0.102 client-id=1:2:0:0:0:0:4 comment="AP ap2" mac-address=02:00:00:00:00:04 server=defconf
/ip dhcp-server lease add address=192.168.0.120 comment="Printer 2" mac-address=02:00:00:00:00:05 server=defconf
/ip dhcp-server lease add address=192.168.0.130 comment=Hub mac-address=02:00:00:00:00:06 server=defconf
/ip dhcp-server lease add address=192.168.0.132 comment="Light 1" mac-address=02:00:00:00:00:07 server=defconf
/ip dhcp-server lease add address=192.168.0.133 comment="Light 2" mac-address=02:00:00:00:00:08 server=defconf
/ip dhcp-server lease add address=192.168.0.153 client-id=1:2:0:0:0:0:9 comment="DNS server" mac-address=02:00:00:00:00:09 server=defconf
/ip dhcp-server lease add address=192.168.0.196 client-id=1:2:0:0:0:0:a comment="LED strip" mac-address=02:00:00:00:00:0A server=defconf
/ip dhcp-server lease add address=192.168.0.200 client-id=1:2:0:0:0:0:b comment=Printer mac-address=02:00:00:00:00:0B server=defconf
/ip dhcp-server lease add address=192.168.0.227 client-id=1:2:0:0:0:0:c comment=media-server mac-address=02:00:00:00:00:0C server=defconf
/interface wifi datapath add bridge=bridge name=dp-lan
/interface wifi configuration add datapath=dp-lan mode=ap name=cfg-main   security=sec-main ssid=HomeNet
/interface wifi configuration add datapath=dp-lan mode=ap name=cfg-iot   security=sec-iot ssid=HomeNet-IoT
/interface wifi configuration add datapath=dp-lan mode=ap name=cfg-5g security=sec-iot ssid=HomeNet-5
/interface wifi set [ find default-name=wifi1 ] channel.frequency=5180 .width=20/40/80mhz configuration=cfg-main disabled=no
/interface wifi set [ find default-name=wifi2 ] configuration=cfg-main disabled=no
/interface wifi add configuration=cfg-iot   disabled=no mac-address=02:00:00:00:00:0D master-interface=wifi1 name=wifi1-iot
/interface wifi add configuration=cfg-5g disabled=no mac-address=02:00:00:00:00:0E master-interface=wifi1 name=wifi1-5g
/interface wifi add configuration=cfg-iot   disabled=no mac-address=02:00:00:00:00:0F master-interface=wifi2 name=wifi2-iot
/interface wifi capsman set enabled=yes interfaces=bridge upgrade-policy=none
/interface wifi provisioning add action=create-enabled master-configuration=cfg-main slave-configurations=cfg-iot
/interface wifi add configuration=cfg-main configuration.tx-power=17 disabled=no name=cap-wifi1 radio-mac=02:00:00:00:00:10
/interface wifi add configuration=cfg-iot disabled=no mac-address=02:00:00:00:00:11 master-interface=cap-wifi1 name=cap-wifi1-virtual1
/interface wifi add configuration=cfg-main configuration.tx-power=11 disabled=no name=cap-wifi2 radio-mac=02:00:00:00:00:12
/interface wifi add configuration=cfg-iot disabled=no mac-address=02:00:00:00:00:13 master-interface=cap-wifi2 name=cap-wifi2-virtual1
/ip firewall filter add action=accept chain=input comment="defconf: accept established,related,untracked" connection-state=established,related,untracked
/ip firewall filter add action=drop   chain=input comment="defconf: drop invalid" connection-state=invalid
/ip firewall filter add action=accept chain=input comment="defconf: accept ICMP" protocol=icmp
/ip firewall filter add action=accept chain=input comment="defconf: accept to local loopback (for CAPsMAN)" dst-address=127.0.0.1 in-interface=lo src-address=127.0.0.1
/ip firewall filter add action=accept chain=input comment="guest: dns dhcp mdns" dst-port=53,67,5353 in-interface=br-guest protocol=udp
/ip firewall filter add action=accept chain=input comment="guest: dns + hotspot login" dst-port=53,64872-64875 in-interface=br-guest protocol=tcp
/ip firewall filter add action=drop   chain=input comment="defconf: drop all not coming from LAN" in-interface-list=!LAN
/ip firewall filter add action=accept chain=forward comment="defconf: accept in ipsec policy"  ipsec-policy=in,ipsec
/ip firewall filter add action=accept chain=forward comment="defconf: accept out ipsec policy" ipsec-policy=out,ipsec
/ip firewall filter add action=fasttrack-connection chain=forward comment="defconf: fasttrack" connection-state=established,related
/ip firewall filter add action=accept chain=forward comment="defconf: accept established,related, untracked" connection-state=established,related,untracked
/ip firewall filter add action=drop   chain=forward comment="defconf: drop invalid" connection-state=invalid
/ip firewall filter add action=accept chain=forward comment="guest: printer" dst-address=192.168.0.200 in-interface-list=GUEST
/ip firewall filter add action=drop   chain=forward comment="guest: no LAN" connection-nat-state=!dstnat in-interface-list=GUEST out-interface-list=!WAN
/ip firewall filter add action=drop   chain=forward comment="defconf: drop all from WAN not DSTNATed" connection-nat-state=!dstnat in-interface-list=WAN
/ip firewall filter add action=passthrough chain=unused-hs-chain comment="place hotspot rules here" disabled=yes
/ip firewall nat add action=masquerade chain=srcnat comment="defconf: masquerade" ipsec-policy=out,none out-interface-list=WAN
/ip firewall nat add action=accept chain=dstnat comment="guest: hotspot address is not media-server" dst-address=10.50.0.1
/ip firewall nat add action=dst-nat chain=dstnat comment="hub port forward" dst-port=18080 in-interface-list=WAN protocol=tcp to-addresses=192.168.0.130 to-ports=8080
/ip firewall nat add action=dst-nat chain=dstnat comment="ssh 20022 -> media-server" dst-port=20022 in-interface-list=WAN protocol=tcp to-addresses=192.168.0.227 to-ports=22
/ip firewall nat add action=dst-nat chain=dstnat comment="web 80/443 -> media-server nginx" dst-address=!192.168.0.1 dst-address-type=local dst-port=80,443 protocol=tcp to-addresses=192.168.0.227
/ip firewall nat add action=masquerade chain=srcnat comment="hairpin for web -> media-server" dst-address=192.168.0.227 dst-port=80,443 out-interface=bridge protocol=tcp src-address=192.168.0.0/24
/ip firewall nat add action=passthrough chain=unused-hs-chain comment="place hotspot rules here" disabled=yes
/interface bridge add name=br-guest
/interface vlan add interface=bridge name=vlan50-guest vlan-id=50
/interface vlan add interface=bridge name=vlan51-guest vlan-id=51
/interface bridge port add bridge=br-guest horizon=1 interface=vlan50-guest
/interface bridge port add bridge=br-guest horizon=1 interface=vlan51-guest
/interface list add name=GUEST
/interface list member add interface=br-guest list=GUEST
/ip address add address=10.50.0.1/24 interface=br-guest network=10.50.0.0
/interface wifi datapath add bridge=br-guest bridge-horizon=1 client-isolation=yes name=dp-guest traffic-processing=on-cap
/interface wifi configuration add datapath=dp-guest mode=ap name=cfg-guest security=sec-guest ssid=HomeNet-Guest
/interface wifi add configuration=cfg-guest disabled=no mac-address=02:00:00:00:00:14 master-interface=wifi1 name=wifi1-guest
/interface wifi add configuration=cfg-guest disabled=no mac-address=02:00:00:00:00:15 master-interface=wifi2 name=wifi2-guest
/ip hotspot add address-pool=guest-pool disabled=no interface=br-guest name=hs-guest profile=hs-guest
/system identity set name=core
