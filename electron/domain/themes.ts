import fs from 'node:fs';
import path from 'node:path';
import type { ThemeProposal } from '../../shared/themes';

/** Propuestas de vídeos temáticos pendientes de elegir formato. Se guardan en un archivo aparte (como las valoraciones), no en el almacén principal. */
export class ThemeStore {
  private data: Record<string, ThemeProposal[]> = {};

  constructor(
    private readonly file: string,
    private readonly onChange: () => void = () => undefined,
  ) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, ThemeProposal[]>;
      if (j && typeof j === 'object') this.data = j;
    } catch {
      /* sin archivo: no hay propuestas */
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch {
      /* si no se puede guardar, la propuesta se pierde al cerrar: no es grave */
    }
  }

  /** Sustituye las propuestas pendientes del directo por las nuevas (las ya resueltas no se tocan). */
  put(vodId: string, proposals: ThemeProposal[]): void {
    const done = (this.data[vodId] ?? []).filter((p) => p.status !== 'pending');
    this.data[vodId] = [...done, ...proposals];
    this.save();
    this.onChange();
  }

  pending(): ThemeProposal[] {
    return Object.values(this.data)
      .flat()
      .filter((p) => p.status === 'pending');
  }

  hasPending(vodId: string): boolean {
    return (this.data[vodId] ?? []).some((p) => p.status === 'pending');
  }

  pendingSpans(vodId: string): { start: number; end: number }[] {
    return (this.data[vodId] ?? []).filter((p) => p.status === 'pending').flatMap((p) => p.pieces.map((x) => ({ start: x.start, end: x.end })));
  }

  get(id: string): ThemeProposal | undefined {
    return Object.values(this.data)
      .flat()
      .find((p) => p.id === id);
  }

  resolve(id: string, status: 'accepted' | 'dismissed', format?: 'long' | 'shorts'): void {
    const p = this.get(id);
    if (!p) return;
    p.status = status;
    if (format) p.format = format;
    this.save();
    this.onChange();
  }
}
