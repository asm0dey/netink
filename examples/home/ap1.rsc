# AP1 - hAP ac lite, 192.168.0.101, RouterOS 7.25
/interface bridge add admin-mac=02:00:00:00:00:03 auto-mac=no name=bridgeLocal port-cost-mode=short
/interface bridge port add bridge=bridgeLocal ingress-filtering=no interface=ether1 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridgeLocal ingress-filtering=no interface=ether2 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridgeLocal ingress-filtering=no interface=ether3 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridgeLocal ingress-filtering=no interface=ether4 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridgeLocal ingress-filtering=no interface=ether5 internal-path-cost=10 path-cost=10
/interface bridge port add bridge=bridgeLocal interface=wlan1
/interface bridge port add bridge=bridgeLocal interface=wlan2
/interface bridge port add bridge=bridgeLocal interface=wlan1-iot
/interface bridge port add bridge=bridgeLocal interface=wlan2-iot
/interface bridge port add bridge=bridgeLocal horizon=1 interface=wlan1-guest
/interface bridge port add bridge=bridgeLocal horizon=1 interface=wlan2-guest
/ip dhcp-client add interface=bridgeLocal name=bridgeLocal
/interface wireless set [ find default-name=wlan1 ] band=2ghz-b/g/n disabled=no frequency=auto installation=indoor mode=ap-bridge security-profile=sec-main ssid=HomeNet tx-power=12 tx-power-mode=all-rates-fixed wireless-protocol=802.11
/interface wireless set [ find default-name=wlan2 ] band=5ghz-a/n/ac channel-width=20/40/80mhz-XXXX disabled=no frequency=auto installation=indoor mode=ap-bridge security-profile=sec-main ssid=HomeNet tx-power=22 tx-power-mode=all-rates-fixed wireless-protocol=802.11
/interface wireless add disabled=no mac-address=02:00:00:00:00:16 master-interface=wlan1 name=wlan1-iot security-profile=sec-iot ssid=HomeNet-IoT
/interface wireless add disabled=no mac-address=02:00:00:00:00:17 master-interface=wlan2 name=wlan2-iot security-profile=sec-iot ssid=HomeNet-IoT
/interface wireless add default-forwarding=no disabled=no mac-address=02:00:00:00:00:18 master-interface=wlan1 name=wlan1-guest security-profile=sec-guest ssid=HomeNet-Guest vlan-id=50 vlan-mode=use-tag
/interface wireless add default-forwarding=no disabled=no mac-address=02:00:00:00:00:19 master-interface=wlan2 name=wlan2-guest security-profile=sec-guest ssid=HomeNet-Guest vlan-id=50 vlan-mode=use-tag
/interface wireless cap set bridge=bridgeLocal discovery-interfaces=bridgeLocal interfaces=wlan1,wlan2
/system identity set name=ap1
