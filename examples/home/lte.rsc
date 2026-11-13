# LTE - LtAP mini LTE, 192.168.88.1, RouterOS 7.25.1
/interface list add name=WAN
/interface list add name=LAN
/interface list member add interface=bridge list=LAN
/interface list member add interface=lte1 list=WAN
/interface list member add interface=vlan60 list=LAN
/interface vlan add interface=ether1 name=vlan60 vlan-id=60
/interface bridge add admin-mac=02:00:00:00:00:1F auto-mac=no name=bridge
/interface bridge port add bridge=bridge interface=wlan1
/interface wireless set [ find default-name=wlan1 ] band=2ghz-b/g/n channel-width=20/40mhz-XX distance=indoors frequency=auto installation=outdoor mode=ap-bridge ssid=MikroTik-000020 wireless-protocol=802.11
/ip address add address=192.168.88.1/24 interface=vlan60 network=192.168.88.0
/ip firewall filter add action=accept chain=input comment="defconf: accept established,related,untracked" connection-state=established,related,untracked
/ip firewall filter add action=drop chain=input comment="defconf: drop invalid" connection-state=invalid
/ip firewall filter add action=accept chain=input comment="defconf: accept ICMP" protocol=icmp
/ip firewall filter add action=accept chain=input comment="defconf: accept to local loopback (for CAPsMAN)" dst-address=127.0.0.1
/ip firewall filter add action=drop chain=input comment="defconf: drop all not coming from LAN" in-interface-list=!LAN
/ip firewall filter add action=accept chain=forward comment="defconf: accept in ipsec policy" ipsec-policy=in,ipsec
/ip firewall filter add action=accept chain=forward comment="defconf: accept out ipsec policy" ipsec-policy=out,ipsec
/ip firewall filter add action=fasttrack-connection chain=forward comment="defconf: fasttrack" connection-state=established,related
/ip firewall filter add action=accept chain=forward comment="defconf: accept established,related, untracked" connection-state=established,related,untracked
/ip firewall filter add action=drop chain=forward comment="defconf: drop invalid" connection-state=invalid
/ip firewall filter add action=drop chain=forward comment="defconf: drop all from WAN not DSTNATed" connection-nat-state=!dstnat connection-state=new in-interface-list=WAN
/ip firewall nat add action=masquerade chain=srcnat comment="defconf: masquerade" ipsec-policy=out,none out-interface-list=WAN
/system identity set name=lte
