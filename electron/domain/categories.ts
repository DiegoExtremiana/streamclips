import type { Chapter } from '../../shared/categories';
import { fetchChapters } from '../services/downloader';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';

export interface CategoryDeps {
  store: Store;
  log: Logger;
  tools: () => ToolPaths;
  /** Solo pruebas. */
  fetch?: (url: string) => Promise<Chapter[]>;
}

/**
 * Categorías de Twitch (juego o actividad) a lo largo de un VOD. Se piden una sola vez y se guardan en el VOD;
 * si no se pueden leer, el VOD se trata como de una sola categoría (no se bloquea nada).
 */
export class CategoryService {
  constructor(private d: CategoryDeps) {}

  async ensure(vodId: string): Promise<Chapter[]> {
    const vod = this.d.store.data.vods.find((v) => v.id === vodId);
    if (!vod) return [];
    if (vod.chapters) return vod.chapters;
    if (vod.origin === 'clip' || !/^https?:\/\//i.test(vod.url ?? '')) return [];
    try {
      const chapters = await (this.d.fetch ?? ((u) => fetchChapters(this.d.tools(), u)))(vod.url);
      vod.chapters = chapters;
      this.d.store.save();
      if (chapters.length > 1) this.d.log.info(`Categorías de "${vod.title}": ${[...new Set(chapters.map((c) => c.title))].join(', ')}`);
      return chapters;
    } catch (e) {
      this.d.log.warn(`No se pudieron leer las categorías del VOD: ${(e as Error).message.split('\n')[0]}`);
      return []; // no se guarda: se vuelve a intentar la próxima vez
    }
  }
}
