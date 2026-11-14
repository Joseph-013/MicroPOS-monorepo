import os from 'node:os';

const isPrivate = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** The till's IPv4 addresses on its networks, ordinary home and shop ranges (192.168..., 10..., 172.16-31...) first. */
export function lanAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const found: string[] = [];
  for (const list of Object.values(interfaces)) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) found.push(i.address);
  return [...new Set(found)].sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}
