import type { Group, OutputItem, Publication, VodJob } from './types';
import type { CoverAsset } from './covers';
import type { DesignRecord } from './coverDesign';

/** Una tabla de la base de datos de StreamClips: columnas con nombre y una fila por elemento. */
export interface DbTable {
  /** Nombre del archivo y de la tabla (sin extensión). */
  name: string;
  /** Para qué sirve y con qué otras tablas se conecta. */
  about: string;
  columns: string[];
  rows: string[][];
}

const yes = (b: unknown) => (b ? 'Sí' : 'No');
const num = (v: number | undefined, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',') : '');
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');
const dt = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
const mins = (sec?: number) => (typeof sec === 'number' ? num(sec / 60) : '');

export interface DbSnapshot {
  vods: VodJob[];
  outputs: OutputItem[];
  pubs: Publication[];
  groups: Group[];
  covers: CoverAsset[];
  designs: DesignRecord[];
}

/**
 * Las tablas se conectan por identificadores: un directo (Id del directo) tiene vídeos y clips (Id del directo en la tabla
 * de vídeos), y cada vídeo tiene publicaciones (Id del vídeo). Se pueden cruzar en Excel con BUSCARV.
 */
export function buildTables(s: DbSnapshot): DbTable[] {
  const groupName = new Map(s.groups.map((g) => [g.id, g.name]));
  const vodTitle = new Map(s.vods.map((v) => [v.id, v.title]));
  const outTitle = new Map(s.outputs.map((o) => [o.id, o.title]));
  const pubsOf = (id: string) => s.pubs.filter((p) => p.outputId === id);
  const outsOf = (id: string) => s.outputs.filter((o) => o.vodId === id);

  const directos: DbTable = {
    name: 'Directos',
    about: 'Un directo (VOD) por fila: su estado, el análisis del piloto automático y cuántos vídeos y clips han salido de él (Id del directo).',
    columns: ['Id del directo', 'Id de Twitch', 'Título', 'Origen', 'Emitido', 'Duración (min)', 'Descarga', 'Análisis', 'Nota del análisis', 'Palabras transcritas', 'Categorías', 'Día de serie', 'Directo borrado del disco', 'Vídeos largos', 'Clips', 'Dirección'],
    rows: s.vods
      .filter((v) => v.origin !== 'clip')
      .map((v) => {
        const outs = outsOf(v.id);
        return [v.id, v.twitchId ?? '', v.title, v.origin === 'live' ? 'Directo recogido' : 'Añadido a mano', dt(v.streamStartedAt ?? v.createdAt), mins(v.durationSec), v.status, v.autopilot?.status ?? '', v.autopilot?.note ?? '', v.transcript ? String(v.transcript.words) : '', [...new Set((v.chapters ?? []).map((c) => c.title))].join(' / '), v.seriesDay !== undefined ? String(v.seriesDay) : '', yes(v.cleaned), String(outs.filter((o) => o.kind === 'long').length), String(outs.filter((o) => o.kind !== 'long').length), v.url];
      }),
  };

  const videos: DbTable = {
    name: 'Vídeos y clips',
    about: 'Todo lo de la Biblioteca: un vídeo largo o clip por fila. «Id del directo» lo conecta con Directos; «Id del vídeo» con Publicaciones.',
    columns: ['Id del vídeo', 'Id del directo', 'Directo', 'Tipo', 'Título', 'Duración (s)', 'Creado', 'Inicio en el directo (s)', 'Fin en el directo (s)', 'Categoría', 'Carpeta', 'Subtítulos', 'Con miniatura', 'Creado por', 'Revisión', 'Nota del piloto', 'Visibilidad (YouTube)', 'Lista (YouTube)', 'Redes programadas', 'Redes publicadas', 'En la nube'],
    rows: s.outputs.map((o) => {
      const ps = pubsOf(o.id);
      return [o.id, o.vodId ?? '', o.vodId ? (vodTitle.get(o.vodId) ?? '') : '', o.kind === 'long' ? 'Vídeo largo' : 'Clip', o.title, num(o.durationSec), dt(o.createdAt), num(o.start), num(o.end), o.category ?? '', o.groupId ? (groupName.get(o.groupId) ?? '') : '', o.subtitles ?? '', yes(o.thumbnail), o.auto ? 'Piloto automático' : 'A mano', o.auto ? (o.auto.review === 'approved' ? 'Aprobado' : 'Pendiente') : '', num(o.auto?.score), o.kind === 'long' ? (o.visibility === 'public' ? 'Público' : 'Privado') : '', o.playlist ?? '', ps.filter((p) => p.status === 'scheduled' || p.status === 'publishing').map((p) => p.platform).join(', '), ps.filter((p) => p.status === 'published').map((p) => p.platform).join(', '), yes(o.remote)];
    }),
  };

  const pubs: DbTable = {
    name: 'Publicaciones',
    about: 'Cada subida programada o hecha, una por red y vídeo. «Id del vídeo» la conecta con Vídeos y clips.',
    columns: ['Clave', 'Id del vídeo', 'Vídeo', 'Red', 'Programada (UTC)', 'Estado', 'Nota', 'Gestiona la nube'],
    rows: s.pubs.map((p) => [p.key, p.outputId, outTitle.get(p.outputId) ?? '', p.platform, dt(p.scheduledAt), p.status, p.note ?? '', yes(p.cloud)]),
  };

  const carpetas: DbTable = {
    name: 'Carpetas',
    about: 'Las carpetas de la Biblioteca (por tema o por serie), con su carpeta madre y cuántos vídeos tienen.',
    columns: ['Id', 'Nombre', 'Tipo', 'Sección', 'Carpeta madre', 'Creada', 'Elementos'],
    rows: s.groups.map((g) => [g.id, g.name, g.kind === 'series' ? 'Serie' : 'Tema', g.section === 'videos' ? 'Vídeos' : 'Clips', g.parentId ? (groupName.get(g.parentId) ?? '') : '', day(g.createdAt), String(s.outputs.filter((o) => o.groupId === g.id).length)]),
  };

  const designByAsset = new Map(s.designs.filter((d) => d.assetId).map((d) => [d.assetId as string, d]));
  const portadas: DbTable = {
    name: 'Portadas',
    about: 'Piezas, fondos y portadas terminadas del editor, y los diseños guardados (capas) de los que salen.',
    columns: ['Id', 'Nombre', 'Tipo', 'Formato', 'Tamaño (KB)', 'Añadida', 'Diseño guardado', 'Capas del diseño'],
    rows: s.covers.map((c) => {
      const d = designByAsset.get(c.id);
      return [c.id, c.name, c.kind, c.ext.replace('.', ''), num(c.bytes / 1024, 0), day(new Date(c.addedAt).toISOString()), d ? d.name : '', d ? String(d.design.layers.length) : ''];
    }),
  };

  return [directos, videos, pubs, carpetas, portadas];
}

/** CSV para Excel en español: separador «;», comillas dobles y BOM para que respete los acentos. */
export function toCsv(t: Pick<DbTable, 'columns' | 'rows'>): string {
  const q = (x: string) => (/[;"\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  return '﻿' + [t.columns, ...t.rows].map((r) => r.map((c) => q(String(c ?? ''))).join(';')).join('\r\n') + '\r\n';
}

/** Índice legible: qué hay en cada tabla y cómo se conectan. */
export function indexText(tables: Pick<DbTable, 'name' | 'about' | 'rows'>[], extra: { name: string; about: string; rows: number }[] = []): string {
  const all = [...tables.map((t) => ({ name: t.name, about: t.about, rows: t.rows.length })), ...extra];
  return [
    '# Base de datos de StreamClips',
    '',
    'La escribe StreamClips sola y se actualiza cada minuto. Cada archivo .csv es una tabla (se abre con Excel o con cualquier hoja de cálculo; separador «;»).',
    'No la edites aquí: es una copia de lo que hay en el programa. Cópiala a otro sitio si quieres trabajar con ella.',
    '',
    ...all.map((t) => `- **${t.name}** (${t.rows} filas): ${t.about}`),
    '',
    'Conexiones: Directos.«Id del directo» = Vídeos y clips.«Id del directo»; Vídeos y clips.«Id del vídeo» = Publicaciones.«Id del vídeo».',
    '',
  ].join('\n');
}
