#!/usr/bin/env node
// whisper-cli (whisper.cpp) simulado para las pruebas: mismo contrato de línea de comandos y de JSON.
//   FAKE_MODE  ok | fail | nofile | empty | garbage | tags
//   FAKE_LOG   archivo donde se anota el argv de cada ejecución
const fs = require('node:fs');

const args = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\n');
const mode = process.env.FAKE_MODE || 'ok';
const get = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const wav = get('-f');
const model = get('-m');
const of = get('-of');
if (mode === 'fail') {
  console.error('error: failed to load model');
  process.exit(1);
}
if (!model || !fs.existsSync(model)) {
  console.error('error: no se encuentra el modelo');
  process.exit(2);
}
// modelo dañado: whisper.cpp lo lee, se pierde a mitad y termina con código 3 («unknown tensor»)
if (fs.readFileSync(model).subarray(0, 4).toString('latin1') === 'BAD!') {
  console.error('whisper_model_load:          CPU total size =   487.01 MB\nwhisper_model_load: unknown tensor \'\u0001\u0002\ufffd\' in model file\nwhisper_init_with_params_no_state: failed to load model\nerror: failed to initialize whisper context');
  process.exit(3);
}
if (!wav || !fs.existsSync(wav) || fs.statSync(wav).size < 2000) {
  console.error('error: audio vacío');
  process.exit(3);
}
for (const f of ['-oj', '-ml', '-sow']) if (!args.includes(f)) { console.error('faltan argumentos: ' + f); process.exit(4); }
if (!of) process.exit(5);
process.stderr.write('whisper_print_progress_callback: progress =  50%\n');
process.stderr.write('whisper_print_progress_callback: progress = 100%\n');
if (mode === 'nofile') process.exit(0);
// el trozo se llama c<i>.wav: se usa su número para que cada trozo "diga" cosas distintas
const idx = Number(/c(\d+)\.wav$/.exec(wav)?.[1] ?? 0);
const items =
  mode === 'empty'
    ? []
    : [
        { text: ' [BLANK_AUDIO]', offsets: { from: 0, to: 500 } },
        { text: ' Hola', offsets: { from: 1000, to: 1400 } },
        { text: ' a', offsets: { from: 1400, to: 1500 } },
        { text: ' todos.', offsets: { from: 1500, to: 2000 } },
        { text: ' (música)', offsets: { from: 2000, to: 2500 } },
        { text: ` trozo${idx}`, offsets: { from: 3000, to: 3500 } },
      ];
if (mode === 'tags') items.push({ text: ' ♪', offsets: { from: 4000, to: 4500 } });
const out = mode === 'garbage' ? '{no json' : JSON.stringify({ result: { language: get('-l') }, transcription: items.map((t) => ({ ...t, timestamps: { from: '00:00:00,000', to: '00:00:01,000' } })) });
fs.writeFileSync(of + '.json', out);
