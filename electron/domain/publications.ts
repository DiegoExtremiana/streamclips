import { ALL_PLATFORMS } from '../../shared/types';
import type { Platform, Publication, ScheduleEntry, ScheduleResult } from '../../shared/types';
import type { Store } from '../services/store';
import type { Notifier } from './notifier';

/** Margen para aceptar "ahora mismo" sin que cuente como fecha pasada. */
const PAST_GRACE_MS = 60_000;

export class PublicationService {
  constructor(
    private store: Store,
    private notifier: Notifier,
    private now: () => number = Date.now,
  ) {}

  list(): Publication[] {
    return this.store.data.publications;
  }

  schedule(outputId: string, platforms: Platform[], atIso: string): ScheduleResult {
    if (!this.store.data.outputs.some((o) => o.id === outputId)) throw new Error('El vídeo no existe.');
    const at = Date.parse(atIso);
    if (Number.isNaN(at)) throw new Error('Fecha y hora no válidas.');
    if (at < this.now() - PAST_GRACE_MS) throw new Error('La hora elegida ya ha pasado. Elige una hora futura.');
    const wanted = [...new Set(platforms)];
    if (!wanted.length) throw new Error('Elige al menos una red social.');
    const unknown = wanted.find((p) => !ALL_PLATFORMS.includes(p));
    if (unknown) throw new Error(`Red social no reconocida: ${String(unknown)}.`);

    const result: ScheduleResult = { scheduled: [], skipped: [] };
    for (const platform of wanted) {
      const key = `${outputId}:${platform}`;
      const existing = this.store.data.publications.find((p) => p.key === key);
      if (existing?.status === 'published') {
        result.skipped.push({ platform, reason: 'ya está publicado en esa red' });
      } else if (existing?.status === 'publishing') {
        result.skipped.push({ platform, reason: 'se está publicando ahora mismo' });
      } else if (existing) {
        // reprogramar uno pendiente o reintentar a mano uno fallido
        existing.scheduledAt = new Date(at).toISOString();
        existing.status = 'scheduled';
        existing.note = undefined;
        result.scheduled.push(existing);
      } else {
        const pub: Publication = { key, outputId, platform, scheduledAt: new Date(at).toISOString(), status: 'scheduled' };
        this.store.data.publications.push(pub);
        result.scheduled.push(pub);
      }
    }
    if (result.scheduled.length) {
      this.store.save();
      this.notifier.changed();
    }
    return result;
  }

  /**
   * Deja la programación de un vídeo exactamente como la pide la ventana de edición:
   * las redes indicadas quedan programadas a su hora y las pendientes o fallidas que no se
   * indican se quitan. Lo publicado o en curso no se toca. Todo se valida antes de cambiar nada.
   */
  setSchedule(outputId: string, entries: ScheduleEntry[]): ScheduleResult {
    if (!this.store.data.outputs.some((o) => o.id === outputId)) throw new Error('El vídeo no existe.');
    const seen = new Set<Platform>();
    const parsed: { platform: Platform; at: number }[] = [];
    for (const e of entries) {
      if (!ALL_PLATFORMS.includes(e.platform)) throw new Error(`Red social no reconocida: ${String(e.platform)}.`);
      if (seen.has(e.platform)) throw new Error('Una red social aparece repetida.');
      seen.add(e.platform);
      const at = Date.parse(e.atIso);
      if (Number.isNaN(at)) throw new Error('Fecha y hora no válidas.');
      const existing = this.store.data.publications.find((p) => p.key === `${outputId}:${e.platform}`);
      const unchanged = existing?.status === 'scheduled' && Date.parse(existing.scheduledAt) === at;
      // una hora ya programada que no se toca puede estar en el pasado (esperando a que se conecte la red)
      if (!unchanged && at < this.now() - PAST_GRACE_MS) throw new Error('La hora elegida ya ha pasado. Elige una hora futura.');
      parsed.push({ platform: e.platform, at });
    }

    const result: ScheduleResult = { scheduled: [], skipped: [] };
    let changed = false;
    const keep = new Set(parsed.map((p) => p.platform));
    this.store.data.publications = this.store.data.publications.filter((p) => {
      const drop = p.outputId === outputId && !keep.has(p.platform) && (p.status === 'scheduled' || p.status === 'failed');
      if (drop) changed = true;
      return !drop;
    });
    for (const { platform, at } of parsed) {
      const key = `${outputId}:${platform}`;
      const existing = this.store.data.publications.find((p) => p.key === key);
      const iso = new Date(at).toISOString();
      if (existing?.status === 'published') {
        result.skipped.push({ platform, reason: 'ya está publicado en esa red' });
      } else if (existing?.status === 'publishing') {
        result.skipped.push({ platform, reason: 'se está publicando ahora mismo' });
      } else if (existing) {
        if (existing.status !== 'scheduled' || existing.scheduledAt !== iso) {
          changed = true;
          existing.note = undefined;
        }
        existing.scheduledAt = iso;
        existing.status = 'scheduled';
        result.scheduled.push(existing);
      } else {
        const pub: Publication = { key, outputId, platform, scheduledAt: iso, status: 'scheduled' };
        this.store.data.publications.push(pub);
        result.scheduled.push(pub);
        changed = true;
      }
    }
    if (changed) {
      this.store.save();
      this.notifier.changed();
    }
    return result;
  }

  /** Solo se puede quitar lo pendiente o fallido; lo publicado queda como registro. */
  cancel(key: string): boolean {
    const p = this.store.data.publications.find((x) => x.key === key);
    if (!p || (p.status !== 'scheduled' && p.status !== 'failed')) return false;
    this.store.data.publications = this.store.data.publications.filter((x) => x.key !== key);
    this.store.save();
    this.notifier.changed();
    return true;
  }
}
