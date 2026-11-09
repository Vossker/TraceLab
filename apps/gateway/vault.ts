import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { tokenSchema } from './official';

export const grantSchema = z.object({ token: tokenSchema, clientId: z.string(), openid: z.string(), name: z.string(), face: z.string().nullable() });
export type Grant = z.infer<typeof grantSchema>;
export interface Vault { read(): Grant | null; write(grant: Grant): void; clear(): void }
export class EncryptedVault implements Vault {
  private key: Buffer;
  constructor(private file: string, secret: string) { this.key = createHash('sha256').update('CreatorTrace OAuth vault\0' + secret).digest(); }
  read(): Grant | null {
    if (!existsSync(this.file)) return null;
    try {
      const bytes = readFileSync(this.file);
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28));
      return grantSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')));
    } catch { throw new Error('无法解密本地授权，请恢复原 LIVE_DATA_KEY，或删除 .data/gateway/oauth.enc 后重新授权'); }
  }
  write(grant: Grant) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(grantSchema.parse(grant)), 'utf8'), cipher.final()]);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 }); renameSync(this.file + '.tmp', this.file);
  }
  clear() { if (existsSync(this.file)) unlinkSync(this.file); }
}
