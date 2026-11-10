import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 凭证/配置文件在磁盘上的形态：
 *  - 未设置 CAMPUS_AGENT_SECRET 时明文 JSON（权限 0600）
 *  - 设置后以 AES-256-GCM 加密，文件以魔数前缀标识
 */
const MAGIC = "CAMPUS_AGENT_V1:";

function getSecret(): Buffer | null {
  const raw = process.env.CAMPUS_AGENT_SECRET;
  if (!raw) return null;
  return scryptSync(raw, "campus-agent-salt", 32);
}

export function readConfigFile(path: string): string {
  const raw = readFileSync(path, "utf8");
  if (!raw.startsWith(MAGIC)) return raw;

  const secret = getSecret();
  if (!secret) {
    throw new Error(
      "配置文件已加密，但未设置 CAMPUS_AGENT_SECRET 环境变量，无法解密。"
    );
  }
  const buf = Buffer.from(raw.slice(MAGIC.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", secret, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

export function writeConfigFile(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  let output = data;
  const secret = getSecret();
  if (secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, iv);
    const ciphertext = Buffer.concat([
      cipher.update(data, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    output = MAGIC + Buffer.concat([iv, ciphertext, tag]).toString("base64");
  }
  writeFileSync(path, output, { mode: 0o600 });
  chmodSync(path, 0o600);
}
