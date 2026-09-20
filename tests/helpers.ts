import { generateKeyPairSync, sign } from "node:crypto";

export function signingFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  return {
    publicKey: rawPublicKey,
    signed(body: string, timestamp = Math.floor(Date.now() / 1000).toString()) {
      const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
      return {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature-Ed25519": signature,
          "X-Signature-Timestamp": timestamp,
        },
        body,
      };
    },
  };
}

export function commandBody(name: string): string {
  return JSON.stringify({ type: 2, data: { type: 1, name } });
}
