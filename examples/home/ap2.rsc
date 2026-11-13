# AP2 - hAP ac2, 192.168.0.102, RouterOS 7.25
/interface bridge add admin-mac=02:00:00:00:00:04 auto-mac=no igmp-snooping=yes igmp-version=3 mld-version=2 multicast-querier=yes name=bridge port-cost-mode=short
/interface bridge port add bridge=bridge interface=ether1
/interface bridge port add bridge=bridge interface=ether2 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridge interface=ether3 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridge interface=ether4 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridge interface=ether5 internal-path-cost=10 path-cost=10
/interface list add name=WAN
/interface list add name=LAN
/interface list member add interface=bridge list=LAN
/interface list member add interface=ether1 list=LAN
/ip dhcp-client add interface=bridge name=ether1
/interface bridge add name=br-guest
/interface vlan add interface=bridge name=vlan51-guest vlan-id=51
/interface bridge port add bridge=br-guest interface=vlan51-guest
/interface wifi datapath add bridge=bridge name=capdp
/interface wifi datapath add bridge=br-guest bridge-horizon=1 client-isolation=yes name=dp-guest
/interface wifi configuration add datapath=capdp    mode=ap name=cfg-main  security=sec-main  ssid=HomeNet
/interface wifi configuration add datapath=capdp    mode=ap name=cfg-iot  security=sec-iot  ssid=HomeNet-IoT
/interface wifi configuration add datapath=dp-guest mode=ap name=cfg-guest security=sec-guest ssid=HomeNet-Guest
/interface wifi set [ find default-name=wifi1 ] configuration=cfg-main configuration.manager=local .tx-power=11 datapath=capdp disabled=no
/interface wifi set [ find default-name=wifi2 ] channel.frequency=5500 .width=20/40/80mhz configuration=cfg-main configuration.manager=local .tx-power=17 datapath=capdp disabled=no
/interface wifi add configuration=cfg-iot  disabled=no mac-address=02:00:00:00:00:11 master-interface=wifi1 name=wifi1-iot
/interface wifi add configuration=cfg-iot  disabled=no mac-address=02:00:00:00:00:1A master-interface=wifi2 name=wifi2-iot
/interface wifi add configuration=cfg-guest disabled=no mac-address=02:00:00:00:00:1B master-interface=wifi1 name=wifi1-guest
/interface wifi add configuration=cfg-guest disabled=no mac-address=02:00:00:00:00:1C master-interface=wifi2 name=wifi2-guest
/ip address add address=192.168.1.1/24 disabled=yes interface=bridge network=192.168.1.0
/ip dhcp-server lease add address=192.168.1.200 client-id=1:2:0:0:0:0:5 mac-address=02:00:00:00:00:05 server=defconf
/ip dhcp-server lease add address=192.168.1.2 client-id=1:2:0:0:0:0:1d mac-address=02:00:00:00:00:1D server=defconf
/ip dhcp-server lease add address=192.168.1.130 client-id=1:2:0:0:0:0:6 mac-address=02:00:00:00:00:06 server=defconf
/ip dhcp-server lease add address=192.168.1.201 client-id=1:2:0:0:0:0:3 mac-address=02:00:00:00:00:03 server=defconf
/ip dhcp-server lease add address=192.168.1.202 client-id=1:2:0:0:0:0:1e mac-address=02:00:00:00:00:1E server=defconf
/ip dhcp-server lease add address=192.168.1.132 mac-address=02:00:00:00:00:07 server=defconf
/ip address add address=192.168.19.1/24 interface=wg1 network=192.168.19.0
/ip firewall filter add action=accept chain=input disabled=yes dst-port=8291 protocol=tcp
/ip firewall filter add action=accept chain=input comment="defconf: accept established,related,untracked" connection-state=established,related,untracked disabled=yes
/ip firewall filter add action=accept chain=forward disabled=yes dst-port=18080 protocol=tcp
/ip firewall filter add action=accept chain=input comment="allow IPsec NAT" disabled=yes dst-port=4500 protocol=udp
/ip firewall filter add action=accept chain=input comment="allow IKE" disabled=yes dst-port=500 protocol=udp
/ip firewall filter add action=accept chain=input comment="allow l2tp" disabled=yes dst-port=1701 protocol=udp
/ip firewall filter add action=accept chain=input disabled=yes dst-port=18080 protocol=tcp
/ip firewall filter add action=drop chain=input comment="defconf: drop invalid" connection-state=invalid disabled=yes
/ip firewall filter add action=accept chain=input comment="defconf: accept ICMP" disabled=yes protocol=icmp
/ip firewall filter add action=accept chain=input comment="defconf: accept to local loopback (for CAPsMAN)" disabled=yes dst-address=127.0.0.1
/ip firewall filter add action=drop chain=input comment="defconf: drop all not coming from LAN" disabled=yes in-interface-list=!LAN
/ip firewall filter add action=accept chain=forward comment="defconf: accept in ipsec policy" disabled=yes ipsec-policy=in,ipsec
/ip firewall filter add action=accept chain=forward comment="defconf: accept out ipsec policy" disabled=yes ipsec-policy=out,ipsec
/ip firewall filter add action=fasttrack-connection chain=forward comment="defconf: fasttrack" connection-state=established,related disabled=yes
/ip firewall filter add action=accept chain=forward comment="defconf: accept established,related, untracked" connection-state=established,related,untracked disabled=yes
/ip firewall filter add action=drop chain=forward comment="defconf: drop invalid" connection-state=invalid disabled=yes
/ip firewall filter add action=drop chain=forward comment="defconf: drop all from WAN not DSTNATed" connection-nat-state=!dstnat connection-state=new disabled=yes in-interface-list=WAN
/ip firewall nat add action=masquerade chain=srcnat comment="defconf: masquerade" disabled=yes ipsec-policy=out,none out-interface-list=WAN
/ip firewall nat add action=dst-nat chain=dstnat comment="hub port forward" disabled=yes dst-address=192.168.0.201 dst-port=18080 log-prefix=hub protocol=tcp to-addresses=192.168.1.130 to-ports=8080
/system identity set name=ap2
