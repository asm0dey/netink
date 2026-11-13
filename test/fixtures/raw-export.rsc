# 2026-11-01 12:00:00 by RouterOS 7.25.1
# model = C53UiG+5HPaxD2HPaxD
/interface bridge vlan
add bridge=bridge tagged=ether1,bridge \
    untagged=ether4 vlan-ids=10
/interface bridge
add name=bridge vlan-filtering=yes
