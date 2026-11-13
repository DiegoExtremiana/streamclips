/** Cronómetro por fases: cada `mark` cierra la fase anterior y abre la siguiente. Sirve para saber en qué se va el tiempo de un análisis. */
export class PhaseClock {
  private readonly ms = new Map<string, number>();
  private current: string | null = null;
  private since: number;

  constructor(private readonly now: () => number = Date.now) {
    this.since = now();
  }

  /** Empieza una fase (cierra la anterior). */
  mark(phase: string | null): void {
    const t = this.now();
    if (this.current) this.ms.set(this.current, (this.ms.get(this.current) ?? 0) + (t - this.since));
    this.current = phase;
    this.since = t;
  }

  /** Segundos por fase (ya cerradas). */
  seconds(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.ms) out[k] = Math.round(v / 100) / 10;
    return out;
  }

  /** «volumen 40 s, transcripción 3 min…», de lo más lento a lo más rápido; ignora lo que no llega a 1 s. */
  describe(): string {
    return [...this.ms.entries()]
      .filter(([, v]) => v >= 1000)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v >= 90_000 ? `${Math.round(v / 60_000)} min` : `${Math.round(v / 1000)} s`}`)
      .join(', ');
  }
}
