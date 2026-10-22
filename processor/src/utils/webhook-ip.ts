import { isIP } from "node:net";

const normalize = (value: string) =>
  value.startsWith("::ffff:") ? value.slice(7) : value;
const internalPeer = (value: string): boolean => {
  const [first, second] = value.split(".").map(Number);
  return (
    value === "::1" ||
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
};
/** Existing Connect/GFE forwarding convention: ... , client, load balancer.
 * Use only the appended client slot, never any matching address in the list.
 * The deployed ingress must enforce this convention; arbitrary self-hosted
 * proxy topologies are outside this connector's deployment contract. */
export function webhookCallerIp(
  socketIp: string,
  forwarded?: string | string[],
): string {
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const addresses = value?.split(",").map((ip) => ip.trim()) ?? [];
  const socket = normalize(socketIp);
  const caller =
    internalPeer(socket) && addresses.length >= 2
      ? addresses[addresses.length - 2]
      : socket;
  const normalized = normalize(caller);
  return isIP(normalized) ? normalized : normalize(socketIp);
}
