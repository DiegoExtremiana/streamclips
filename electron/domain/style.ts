import fs from 'node:fs';
import path from 'node:path';
import { addLore, cleanStyle, defaultStyle, patchStyle, removeLore, type StyleProfile } from '../../shared/styleProfile';

/** Guarda y entrega el perfil de estilo del creador (un solo archivo, escrito de forma atómica). */
export class StyleService {
  constructor(private readonly file: string) {}

  get(): StyleProfile {
    try {
      return cleanStyle(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return defaultStyle();
    }
  }

  private save(p: StyleProfile): StyleProfile {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
    fs.renameSync(tmp, this.file);
    return p;
  }

  set(patch: unknown): StyleProfile {
    return this.save(patchStyle(this.get(), patch));
  }

  addLore(name: string, note?: string, triggers?: string[]): StyleProfile {
    return this.save(addLore(this.get(), name, note, triggers));
  }

  removeLore(id: string): StyleProfile {
    return this.save(removeLore(this.get(), id));
  }

  reset(): StyleProfile {
    return this.save(defaultStyle());
  }
}
