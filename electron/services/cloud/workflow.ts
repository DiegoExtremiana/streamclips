/** Hora UTC (minuto, hora) de un instante dado. */
const utc = (d: Date) => ({ m: d.getUTCMinutes(), h: d.getUTCHours() });

/**
 * Las ejecuciones se piden justo después de cada hora en que hay algo que publicar (más un repaso cada pocas horas por si
 * alguna se retrasa). GitHub no garantiza la hora exacta: puede tardar unos minutos en arrancar.
 */
export function cronLines(times: Date[], opts: { fallbackHours?: number; max?: number } = {}): string[] {
  const set = new Map<string, string>();
  for (const t of times) {
    const d = new Date(t.getTime() + 60_000); // un minuto después, para que ya esté vencido
    const { m, h } = utc(d);
    set.set(`${m}:${h}`, `${m} ${h} * * *`);
  }
  const lines = [...set.values()].sort().slice(0, opts.max ?? 20);
  lines.push(`23 */${opts.fallbackHours ?? 3} * * *`);
  return lines;
}

export function workflowYaml(crons: string[]): string {
  return `# Generado por StreamClips. No lo edites a mano: el programa lo vuelve a escribir.
name: Publicar
on:
  workflow_dispatch:
  schedule:
${crons.map((c) => `    - cron: '${c}'`).join('\n')}
concurrency:
  group: streamclips-publish
  cancel-in-progress: false
permissions:
  contents: write
jobs:
  publicar:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v4
        with:
          sparse-checkout: runner
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node runner/runner.js
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          STREAMCLIPS_CREDS: \${{ secrets.STREAMCLIPS_CREDS }}
`;
}
