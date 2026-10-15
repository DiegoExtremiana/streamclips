/** Cifrado del sistema (en Electron: safeStorage). Se inyecta para poder probarlo sin Electron. */
export interface Cipher {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

/**
 * Guarda secretos como texto con prefijo:
 *   enc:<base64>    cifrado por el sistema (Windows DPAPI en Electron)
 *   plain:<base64>  sin cifrar, solo si el sistema no ofrece cifrado
 */
export class Secrets {
  constructor(private cipher: Cipher) {}

  encode(secret: string): string {
    if (!secret) return '';
    if (this.cipher.available()) return `enc:${this.cipher.encrypt(secret).toString('base64')}`;
    return `plain:${Buffer.from(secret, 'utf8').toString('base64')}`;
  }

  /** Devuelve '' si el valor no se puede descifrar (p. ej. el archivo viene de otro PC). */
  decode(stored: string): string {
    try {
      if (stored.startsWith('enc:')) return this.cipher.decrypt(Buffer.from(stored.slice(4), 'base64'));
      if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8');
    } catch {
      return '';
    }
    return '';
  }
}
