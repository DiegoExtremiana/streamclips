import { ALL_PLATFORMS, platformsFor, VIDEO_ONLY_YOUTUBE } from '../../shared/types';
import type { Platform, Publication, ScheduleEntry, ScheduleResult } from '../../shared/types';
import type { Store } from '../services/store';
import type { Notifier } from './notifier';

/** Margen para aceptar "ahora mismo" sin que cuente como fecha pasada. */
const PAST_GRACE_MS = 60_000;
/** Dos subidas a la misma red más cerca que esto se avisan (no se impiden). */
const NEAR_MS = 30 * 60_000;
/** Subidas a YouTube por día con la cuota gratuita estándar de la API (10.000 puntos; cada subida cuesta 1.600). */
const YOUTUBE_DAILY = 6;
const LABEL: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export class PublicationService {
  constructor(
    private store: Store,
    private notifier: Notifier,
    private now: () => number = Date.now,
  ) {}

  list(): Publication[] {
    return this.store.data.publications;
  }

  /**
   * Avisos sobre lo recién programado: dos subidas casi a la vez en la misma red, o más subidas a YouTube
   * en un día de las que permite la cuota gratuita. No impiden programar; el usuario decide.
   */
  private warningsFor(scheduled: Publication[]): string[] {
    const out: string[] = [];
    const all = this.store.data.publications.filter((p) => p.status === 'scheduled' || p.status === 'publishing');
    const title = (id: string) => this.store.data.outputs.find((o) => o.id === id)?.title ?? 'otro vídeo';
    for (const p of scheduled) {
      const at = Date.parse(p.scheduledAt);
      for (const q of all) {
        if (q.key === p.key || q.platform !== p.platform) continue;
        const qa = Date.parse(q.scheduledAt);
        if (Math.abs(qa - at) < NEAR_MS) out.push(`Ya hay otra subida a ${LABEL[p.platform]} a las ${hhmm(qa)} («${title(q.outputId)}»), muy cerca de esta.`);
      }
      if (p.platform === 'youtube') {
        const n = all.filter((q) => q.platform === 'youtube' && dayKey(Date.parse(q.scheduledAt)) === dayKey(at)).length;
        if (n > YOUTUBE_DAILY) out.push(`Ese día tienes ${n} subidas a YouTube. Con la cuota gratuita estándar de la API caben unas ${YOUTUBE_DAILY} al día; las demás podrían fallar.`);
      }
    }
    return [...new Set(out)];
  }

  schedule(outputId: string, platforms: Platform[], atIso: string): ScheduleResult {
    const out = this.store.data.outputs.find((o) => o.id === outputId);
    if (!out) throw new Error('El vídeo no existe.');
    const at = Date.parse(atIso);
    if (Number.isNaN(at)) throw new Error('Fecha y hora no válidas.');
    if (at < this.now() - PAST_GRACE_MS) throw new Error('La hora elegida ya ha pasado. Elige una hora futura.');
    const wanted = [...new Set(platforms)];
    if (!wanted.length) throw new Error('Elige al menos una red social.');
    const unknown = wanted.find((p) => !ALL_PLATFORMS.includes(p));
    if (unknown) throw new Error(`Red social no reconocida: ${String(unknown)}.`);

    const allowed = platformsFor(out.kind);
    if (wanted.every((pl) => !allowed.includes(pl))) throw new Error(VIDEO_ONLY_YOUTUBE);

    const result: ScheduleResult = { scheduled: [], skipped: [] };
    for (const platform of wanted) {
      if (!allowed.includes(platform)) {
        result.skipped.push({ platform, reason: 'los vídeos solo se publican en YouTube' });
        continue;
      }
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
      const w = this.warningsFor(result.scheduled);
      if (w.length) result.warnings = w;
    }
    return result;
  }

  /**
   * Deja la programación de un vídeo exactamente como la pide la ventana de edición:
   * las redes indicadas quedan programadas a su hora y las pendientes o fallidas que no se
   * indican se quitan. Lo publicado o en curso no se toca. Todo se valida antes de cambiar nada.
   */
  setSchedule(outputId: string, entries: ScheduleEntry[]): ScheduleResult {
    const out = this.store.data.outputs.find((o) => o.id === outputId);
    if (!out) throw new Error('El vídeo no existe.');
    const seen = new Set<Platform>();
    const parsed: { platform: Platform; at: number }[] = [];
    for (const e of entries) {
      if (!ALL_PLATFORMS.includes(e.platform)) throw new Error(`Red social no reconocida: ${String(e.platform)}.`);
      if (seen.has(e.platform)) throw new Error('Una red social aparece repetida.');
      if (!platformsFor(out.kind).includes(e.platform)) throw new Error(VIDEO_ONLY_YOUTUBE);
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
    const w = this.warningsFor(result.scheduled);
    if (w.length) result.warnings = w;
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
