import assert from "node:assert/strict";
import test from "node:test";

import { findLanIPv4 } from "../scripts/network-address.mjs";

test("prefers a physical LAN interface over VPN and virtual interfaces", () => {
  assert.equal(findLanIPv4({
    utun4: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
    en0: [{ address: "10.19.14.240", family: "IPv4", internal: false }],
    bridge100: [{ address: "192.168.64.1", family: "IPv4", internal: false }],
  }), "10.19.14.240");
});

test("uses the IPv4 selected by the default route when several physical interfaces are active", () => {
  assert.equal(findLanIPv4({
    en0: [{ address: "10.19.14.73", family: "IPv4", internal: false }],
    en10: [{ address: "10.19.14.240", family: "IPv4", internal: false }],
  }, "10.19.14.240"), "10.19.14.240");
});

test("ignores loopback, IPv6 and link-local addresses", () => {
  assert.equal(findLanIPv4({
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    en0: [
      { address: "fe80::1", family: "IPv6", internal: false },
      { address: "169.254.10.20", family: "IPv4", internal: false },
    ],
    eth0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
  }), "192.168.1.20");
});
