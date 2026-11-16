import { describePrefs } from '../../../shared/preferences';
import { loadPrefs } from '../../services/momentStore';
import type { Host } from './context';

const KIND_LABEL: Record<string, string> = { gracia: 'humor', fail: 'fails', reaccion: 'reacciones', discusion: 'discusiones', historia: 'historias', epico: 'momentos épicos', otro: 'otros momentos' };

/**
 * Lo que el equipo ha aprendido del streamer, para que lo tengan en cuenta todos los editores de IA (desde la v0.39.0):
 * los tipos de momento que prefiere según lo que descarta o incluye al revisar, y los vídeos y clips que ha aprobado
 * para publicar (ejemplos de lo que quiere). Sale de lo que hace en el programa, no de suposiciones; vacío si aún no hay nada.
 */
export function lessonsText(d: Host['d']): string {
  const parts: string[] = [];
  if (d.prefsFile) {
    try {
      const prefs = loadPrefs(d.prefsFile);
      const act = prefs.enabled ? describePrefs(prefs).filter((x) => x.active) : [];
      const up = act.filter((x) => x.bias > 0).map((x) => KIND_LABEL[x.kind] ?? x.kind);
      const down = act.filter((x) => x.bias < 0).map((x) => KIND_LABEL[x.kind] ?? x.kind);
      if (up.length) parts.push(`Por lo que revisa, prefiere ${up.join(', ')}.`);
      if (down.length) parts.push(`Suele quitar ${down.join(', ')}: úsalos solo si son muy buenos.`);
    } catch {
      /* sin preferencias guardadas */
    }
  }
  const approved = d.store.data.outputs
    .filter((o) => o.auto?.review === 'approved' && o.title)
    .slice(-12)
    .map((o) => `«${o.title}» (${o.kind === 'long' ? 'vídeo' : 'clip'})`);
  if (approved.length) parts.push(`Ha aprobado para publicar, por ejemplo: ${approved.join(', ')}. Busca cosas de ese estilo.`);
  return parts.length ? ` LO QUE EL EQUIPO HA APRENDIDO DEL STREAMER: ${parts.join(' ')}` : '';
}
