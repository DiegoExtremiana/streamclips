import fs from 'node:fs';
import path from 'node:path';
import type { ClipCorrection } from '../../shared/clipFeedback';

/** Correcciones del streamer a las notas de la IA (archivo aparte, legible y fácil de borrar). Una por clip: corregir otra vez sustituye. */
export class ClipFeedbackStore {
  private list: ClipCorrection[] = [];

  constructor(private readonly file: string) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as ClipCorrection[];
      if (Array.isArray(j)) this.list = j.filter((c) => c && typeof c.clipId === 'string' && c.ai && c.user);
    } catch {
      /* sin correcciones guardadas */
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.list, null, 1));
    } catch {
      /* si no se puede guardar, se pierde al cerrar: no es grave */
    }
  }

  all(): ClipCorrection[] {
    return [...this.list];
  }

  add(c: ClipCorrection): void {
    this.list = [...this.list.filter((x) => x.clipId !== c.clipId), c];
    this.save();
  }

  remove(clipId: string): boolean {
    const n = this.list.length;
    this.list = this.list.filter((x) => x.clipId !== clipId);
    if (this.list.length !== n) this.save();
    return this.list.length !== n;
  }

  clear(): void {
    this.list = [];
    this.save();
  }
}
