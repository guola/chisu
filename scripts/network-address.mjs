import { execFile } from "node:child_process";
import { createSocket } from "node:dgram";
import { networkInterfaces, platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VIRTUAL_INTERFACE = /^(awdl|bridge|clash|docker|llw|lo|ppp|shadowrocket|surge|tailscale|tap|tun|utun|vbox|virbr|vmnet|wg|wireguard)/i;

function isProxyAddress(address) {
  const [first, second] = address.split(".").map(Number);
  return first === 198 && (second === 18 || second === 19);
}

function isUsableInterface(name) {
  return !VIRTUAL_INTERFACE.test(name);
}

function interfacePriority(name) {
  if (name === "en0") return 0;
  if (name === "en1") return 1;
  if (/^(eth0|wlan0)$/i.test(name)) return 2;
  if (/^(en|eth|wlan|wlp)/i.test(name)) return 3;
  if (VIRTUAL_INTERFACE.test(name)) return 20;
  return 10;
}

function addressPriority(address) {
  if (/^192\.168\./.test(address)) return 0;
  if (/^10\./.test(address)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

export function findLanIPv4(interfaces = networkInterfaces(), options = {}) {
  const { routedAddress = "", preferredInterfaces = [] } = options;
  const candidates = Object.entries(interfaces).flatMap(([name, entries = []]) =>
    entries
      .filter((entry) => entry.family === "IPv4"
        && !entry.internal
        && isUsableInterface(name)
        && !entry.address.startsWith("169.254.")
        && !isProxyAddress(entry.address))
      .map((entry) => ({ name, address: entry.address })),
  );

  for (const name of preferredInterfaces) {
    const preferred = candidates.find((candidate) => candidate.name === name);
    if (preferred) return preferred.address;
  }

  if (routedAddress && candidates.some((candidate) => candidate.address === routedAddress)) {
    return routedAddress;
  }

  candidates.sort((left, right) =>
    interfacePriority(left.name) - interfacePriority(right.name)
    || addressPriority(left.address) - addressPriority(right.address)
    || left.address.localeCompare(right.address),
  );

  return candidates[0]?.address ?? "";
}

export function hasTunnelInterface(interfaces = networkInterfaces()) {
  return Object.entries(interfaces).some(([name, entries = []]) =>
    VIRTUAL_INTERFACE.test(name)
    && entries.some((entry) => entry.family === "IPv4" && !entry.internal),
  );
}

async function findMacInterfaceOrder() {
  if (platform() !== "darwin") return [];
  const interfaces = [];

  try {
    const { stdout } = await execFileAsync("/sbin/route", ["-n", "get", "default"], { timeout: 500 });
    const match = stdout.match(/^\s*interface:\s*(\S+)/m);
    if (match) interfaces.push(match[1]);
  } catch {}

  try {
    const { stdout } = await execFileAsync("/usr/sbin/scutil", ["--nwi"], { timeout: 500 });
    const match = stdout.match(/^Network interfaces:\s*(.+)$/m);
    if (match) interfaces.push(...match[1].trim().split(/\s+/));
  } catch {}

  return [...new Set(interfaces)];
}

function findRoutedIPv4() {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;
    let timer;
    const finish = (address) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve(address);
    };
    timer = setTimeout(() => finish(""), 500);

    socket.once("error", () => finish(""));
    socket.connect(53, "1.1.1.1", () => {
      const address = socket.address();
      finish(typeof address === "object" ? address.address : "");
    });
  });
}

export async function findDefaultLanIPv4() {
  const [routedAddress, preferredInterfaces] = await Promise.all([
    findRoutedIPv4(),
    findMacInterfaceOrder(),
  ]);
  return findLanIPv4(networkInterfaces(), { routedAddress, preferredInterfaces });
}
