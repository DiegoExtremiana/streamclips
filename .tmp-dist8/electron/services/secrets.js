"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Secrets = void 0;
/**
 * Guarda secretos como texto con prefijo:
 *   enc:<base64>    cifrado por el sistema (Windows DPAPI en Electron)
 *   plain:<base64>  sin cifrar, solo si el sistema no ofrece cifrado
 */
class Secrets {
    cipher;
    constructor(cipher) {
        this.cipher = cipher;
    }
    encode(secret) {
        if (!secret)
            return '';
        if (this.cipher.available())
            return `enc:${this.cipher.encrypt(secret).toString('base64')}`;
        return `plain:${Buffer.from(secret, 'utf8').toString('base64')}`;
    }
    /** Devuelve '' si el valor no se puede descifrar (p. ej. el archivo viene de otro PC). */
    decode(stored) {
        try {
            if (stored.startsWith('enc:'))
                return this.cipher.decrypt(Buffer.from(stored.slice(4), 'base64'));
            if (stored.startsWith('plain:'))
                return Buffer.from(stored.slice(6), 'base64').toString('utf8');
        }
        catch {
            return '';
        }
        return '';
    }
}
exports.Secrets = Secrets;
