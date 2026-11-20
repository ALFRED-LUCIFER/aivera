import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

// Column-level encryption of the send log's personal data (AIV-P0-017). One 32-byte key (Key Vault secret
// notifications-encryption-key, base64), split with HKDF into an AES-256-GCM key and an HMAC key, so the hash that
// may be logged never reuses the encryption key.

export type Sealer = {
  seal(value: unknown): string;
  open<T>(sealed: string): T;
  /** HMAC-SHA256 of the lower-cased address, hex: the only form of a recipient that may be logged. */
  hash(email: string): string;
};

export function createSealer(base64Key: string): Sealer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('The notifications encryption key must be 32 bytes, base64');
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), info, 32));
  const aesKey = derive('aivera notifications seal v1');
  const hmacKey = derive('aivera notifications recipient hash v1');

  return {
    seal(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), body]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
        .join('.');
    },
    open<T>(sealed: string): T {
      const [version, iv, tag, body] = sealed.split('.');
      if (version !== 'v1' || !iv || !tag || !body) throw new Error('Not a sealed value');
      const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const text = Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
      return JSON.parse(text) as T;
    },
    hash: (email) => createHmac('sha256', hmacKey).update(email.trim().toLowerCase()).digest('hex'),
  };
}
