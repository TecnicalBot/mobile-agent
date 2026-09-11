function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256Base64Url(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64Url(new Uint8Array(digest));
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex: string[] = [];
  for (const value of new Uint8Array(digest)) {
    hex.push(value.toString(16).padStart(2, "0"));
  }
  return hex.join("");
}

export function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomToken(count = 32): string {
  return toBase64Url(randomBytes(count));
}

export function generateCodeVerifier(): string {
  return toBase64Url(randomBytes(48));
}

export function generateCodeChallenge(verifier: string): Promise<string> {
  return sha256Base64Url(verifier);
}