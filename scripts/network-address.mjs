import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";

const VIRTUAL_INTERFACE = /^(awdl|bridge|docker|llw|lo|tailscale|utun|vbox|virbr|vmnet)/i;

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

export function findLanIPv4(interfaces = networkInterfaces(), routedAddress = "") {
  const candidates = Object.entries(interfaces).flatMap(([name, entries = []]) =>
    entries
      .filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))
      .map((entry) => ({ name, address: entry.address })),
  );

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
  const routedAddress = await findRoutedIPv4();
  return findLanIPv4(networkInterfaces(), routedAddress);
}
