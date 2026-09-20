const MAX_TIMESTAMP_AGE_SECONDS = 300;

export function isPublicKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export async function verifyDiscordRequest(
  rawBody: ArrayBuffer,
  headers: Headers,
  publicKey: string,
  now = Date.now(),
): Promise<boolean> {
  const signature = headers.get("X-Signature-Ed25519");
  const timestamp = headers.get("X-Signature-Timestamp");
  if (!isPublicKey(publicKey) || !signature || !/^[0-9a-f]{128}$/i.test(signature)
    || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;

  // Bounds stale/future requests; this is not persistent replay deduplication.
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_TIMESTAMP_AGE_SECONDS) return false;

  const timestampBytes = new TextEncoder().encode(timestamp);
  const message = new Uint8Array(timestampBytes.length + rawBody.byteLength);
  message.set(timestampBytes);
  message.set(new Uint8Array(rawBody), timestampBytes.length);

  try {
    const key = await crypto.subtle.importKey("raw", fromHex(publicKey), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromHex(signature), message);
  } catch {
    return false;
  }
}
