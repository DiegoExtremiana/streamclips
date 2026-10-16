/**
 * Horas (UTC) en las que el motor mira si ha terminado un directo: de las 20:00 a las 04:59 locales, cada 20 minutos.
 * Se calculan con el huso horario de este PC; si cambia (horario de verano) el programa reescribe el flujo.
 */
export function engineCrons(offsetMinutes: number = new Date().getTimezoneOffset(), fromHour = 20, toHour = 4): string[] {
  const hours = new Set<number>();
  for (let h = fromHour; ; h = (h + 1) % 24) {
    hours.add((((h * 60 + offsetMinutes) / 60) % 24 + 24) % 24 | 0);
    if (h === toHour) break;
  }
  return [`5,25,45 ${[...hours].sort((a, b) => a - b).join(',')} * * *`];
}

export const WHISPER_TAG = 'v1.8.4';

/** Flujo de GitHub Actions del motor nocturno. Solo instala las herramientas pesadas cuando de verdad hay un directo que editar. */
export function engineWorkflowYaml(crons: string[]): string {
  return `# Generado por StreamClips. No lo edites a mano: el programa lo vuelve a escribir.
name: Motor nocturno
on:
  workflow_dispatch:
  schedule:
${crons.map((c) => `    - cron: '${c}'`).join('\n')}
concurrency:
  group: streamclips-motor
  cancel-in-progress: false
permissions:
  contents: write
jobs:
  motor:
    runs-on: ubuntu-latest
    timeout-minutes: 350
    env:
      STREAMCLIPS_ENGINE: \${{ secrets.STREAMCLIPS_ENGINE }}
      STREAMCLIPS_PUBLIC_TOKEN: \${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with:
          sparse-checkout: engine
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Mirar si ha terminado un directo
        id: check
        run: node engine/engine.js --check
      - name: Liberar disco
        if: steps.check.outputs.work == 'true'
        run: |
          sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL
          df -h /
      - name: Instalar ffmpeg y yt-dlp
        if: steps.check.outputs.work == 'true'
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y -qq ffmpeg
          sudo curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
          sudo chmod a+rx /usr/local/bin/yt-dlp
      - name: Whisper (caché)
        if: steps.check.outputs.work == 'true'
        id: whisper-cache
        uses: actions/cache@v4
        with:
          path: ~/whisper-cli
          key: whisper-cli-${WHISPER_TAG}-\${{ runner.os }}-\${{ runner.arch }}
      - name: Compilar Whisper
        if: steps.check.outputs.work == 'true' && steps.whisper-cache.outputs.cache-hit != 'true'
        run: |
          git clone --depth 1 --branch ${WHISPER_TAG} https://github.com/ggml-org/whisper.cpp "$RUNNER_TEMP/whisper.cpp"
          cd "$RUNNER_TEMP/whisper.cpp"
          cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF
          cmake --build build -j --config Release --target whisper-cli
          cp build/bin/whisper-cli ~/whisper-cli
      - name: Editar el directo
        if: steps.check.outputs.work == 'true'
        run: |
          export STREAMCLIPS_WHISPER="$HOME/whisper-cli"
          node engine/engine.js
`;
}
