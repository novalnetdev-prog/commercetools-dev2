// Novalnet uses the same v2 gateway for test and live payments. Test mode stays
// in each payment method's existing configuration; this is not a shop URL fallback.
const NOVALNET_V2_ENDPOINT = "https://payport.novalnet.de/v2/";

export function novalnetEndpoint(path: string): string {
  return new URL(path.replace(/^\//, ""), NOVALNET_V2_ENDPOINT).toString();
}
