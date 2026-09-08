import { safeStorage } from "electron";
import type { CredentialCodec } from "../model/config.ts";

// macOS 由 Electron safeStorage 使用系统钥匙串保护，不提供明文降级。
export const desktopCredentials: CredentialCodec = {
  encrypt(value) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("系统加密存储不可用，请解锁钥匙串后重新保存 Key");
    return safeStorage.encryptString(value).toString("base64");
  },
  decrypt(value) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("系统加密存储不可用，请解锁钥匙串后重启应用");
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  },
};
