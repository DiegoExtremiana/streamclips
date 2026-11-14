import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTables, toCsv } from '../shared/databaseTables';
import { DatabaseWriter } from '../electron/services/database';
import type { DbSnapshot } from '../shared/databaseTables';

const snap = (): DbSnapshot => ({
  vods: [{ id: 'v1', url: 'https://www.twitch.tv/videos/1', title: 'Directo; "raro"', status: 'downloaded', progress: 100, createdAt: '2026-11-01T10:00:00Z', durationSec: 7200, autopilot: { status: 'done', at: 'x', note: 'ok' }, transcript: { words: 50, source: 'whisper', at: 'x' }, origin: 'live' }],
  outputs: [
    { id: 'o1', vodId: 'v1', kind: 'clip', title: 'Clip uno', files: {}, durationSec: 30, createdAt: '2026-11-02T10:00:00Z', start: 10, end: 40, groupId: 'g1', auto: { role: 'clip', review: 'approved', score: 8.2 } },
    { id: 'o2', vodId: 'v1', kind: 'long', title: 'Resumen', files: {}, durationSec: 600, createdAt: '2026-11-02T11:00:00Z', visibility: 'public' },
  ],
  pubs: [{ key: 'o1:youtube', outputId: 'o1', platform: 'youtube', scheduledAt: '2026-11-05T10:00:00Z', status: 'published' }, { key: 'o1:tiktok', outputId: 'o1', platform: 'tiktok', scheduledAt: '2026-11-06T10:00:00Z', status: 'scheduled' }],
  groups: [{ id: 'g1', name: 'Pokémon', kind: 'theme', section: 'clips', createdAt: '2026-10-01T00:00:00Z' }],
  covers: [], designs: [],
});

test('las tablas se conectan por identificadores y cuentan lo que hay', () => {
  const t = Object.fromEntries(buildTables(snap()).map((x) => [x.name, x]));
  const d = t['Directos'];
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0][d.columns.indexOf('Vídeos largos')], '1');
  assert.equal(d.rows[0][d.columns.indexOf('Clips')], '1');
  const v = t['Vídeos y clips'];
  const clip = v.rows.find((r) => r[0] === 'o1')!;
  assert.equal(clip[v.columns.indexOf('Id del directo')], 'v1');
  assert.equal(clip[v.columns.indexOf('Carpeta')], 'Pokémon');
  assert.equal(clip[v.columns.indexOf('Redes publicadas')], 'youtube');
  assert.equal(clip[v.columns.indexOf('Redes programadas')], 'tiktok');
  assert.equal(clip[v.columns.indexOf('Nota del piloto')], '8,2');
  assert.equal(t['Publicaciones'].rows[0][2], 'Clip uno');
  assert.equal(t['Carpetas'].rows[0][6], '1');
});

test('el CSV escapa «;» y comillas y lleva BOM', () => {
  const csv = toCsv({ columns: ['a', 'b'], rows: [['x;y', 'di "hola"']] });
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /"x;y";"di ""hola"""/);
});

test('el escritor crea la carpeta, el índice y solo reescribe lo que cambia', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-')), 'Base de datos');
  const s = snap();
  const w = new DatabaseWriter(dir, () => s, () => [{ name: 'Clips de Twitch', file: 'Clips de Twitch.csv', about: 'notas', rows: 3 }]);
  const info = await w.refresh();
  assert.ok(info.some((i) => i.name === 'Clips de Twitch' && i.rows === 3));
  assert.ok(fs.existsSync(path.join(dir, 'Directos.csv')));
  assert.match(fs.readFileSync(path.join(dir, 'Índice.md'), 'utf8'), /Clips de Twitch\*\* \(3 filas\)/);
  const m1 = fs.statSync(path.join(dir, 'Directos.csv')).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await w.refresh();
  assert.equal(fs.statSync(path.join(dir, 'Directos.csv')).mtimeMs, m1, 'sin cambios no se reescribe');
  s.vods[0].title = 'Otro';
  await w.refresh();
  assert.match(fs.readFileSync(path.join(dir, 'Directos.csv'), 'utf8'), /Otro/);
});
