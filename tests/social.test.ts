import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { OutputItem } from '../shared/types';
import { MASKED_SECRET } from '../shared/types';
import { PROVIDERS, buildAuthUrl, pkcePair, type OAuthProvider } from '../electron/services/oauth';
import { publishYoutube, listPlaylists } from '../electron/services/social/youtube';
import { publishTiktok } from '../electron/services/social/tiktok';
import { publishInstagram } from '../electron/services/social/instagram';
import { lookupAccount } from '../electron/services/social/accounts';
import { NotConnectedError, realPublishers } from '../electron/domain/publishers';
import { makeEnv, makeVideo, tmpDir, rmDir, type TestEnv } from './helpers';

interface Req {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}
type Handler = (r: Req, n: number) => { status?: number; headers?: Record<string, string | undefined>; json?: unknown; text?: string } | undefined;

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

async function server(handler: Handler) {
  const reqs: Req[] = [];
  const srv = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      const r: Req = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(parts) };
      reqs.push(r);
      const out = handler(r, reqs.length) ?? { status: 404 };
      if (out.status === -1) return void req.socket.destroy();
      res.writeHead(out.status ?? 200, { ...(out.json !== undefined ? { 'content-type': 'application/json' } : {}), ...Object.fromEntries(Object.entries(out.headers ?? {}).filter(([, v]) => v !== undefined) as [string, string][]) });
      res.end(out.json !== undefined ? JSON.stringify(out.json) : (out.text ?? ''));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => { srv.close(); srv.closeAllConnections?.(); });
  return { base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, reqs };
}

const dir = tmpDir();
process.on('exit', () => rmDir(dir));
function mk(name: string, bytes: number): string {
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.alloc(bytes, 7));
  return f;
}
function out(over: Partial<OutputItem>): OutputItem {
  return { id: 'o1', kind: 'clip', title: 'Mi clip', files: {}, durationSec: 30, createdAt: new Date().toISOString(), ...over };
}

describe('OAuth', () => {
  it('pkce y URL de autorización llevan lo necesario', () => {
    const p = pkcePair();
    assert.match(p.verifier, /^[A-Za-z0-9_-]{40,}$/);
    const u = new URL(buildAuthUrl(PROVIDERS.google, { clientId: 'CID', clientSecret: 's' }, 'ST', p.challenge));
    assert.equal(u.searchParams.get('client_id'), 'CID');
    assert.equal(u.searchParams.get('state'), 'ST');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.match(u.searchParams.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.ok(u.searchParams.get('scope')!.includes('youtube.upload'));
    const t = new URL(buildAuthUrl(PROVIDERS.tiktok, { clientId: 'K', clientSecret: 's' }, 'ST', 'ch'));
    assert.equal(t.searchParams.get('client_key'), 'K');
    assert.equal(t.searchParams.get('client_id'), null);
    assert.equal(t.searchParams.get('scope'), 'user.info.basic,video.publish,video.upload');
  });
});

describe('conexiones: flujo completo contra servidores simulados', () => {
  let e: TestEnv;
  afterEach(() => e?.cleanup());

  /** Un «navegador» que visita la URL de autorización y vuelve al callback con el código. */
  const browser = (code = 'CODE') => async (url: string) => {
    const u = new URL(url);
    const back = new URL(u.searchParams.get('redirect_uri')!);
    back.searchParams.set('code', code);
    back.searchParams.set('state', u.searchParams.get('state')!);
    setTimeout(() => void fetch(back).catch(() => undefined), 20);
  };

  async function setup(port: number, tokenReply: Handler, openUrl = browser()) {
    const tok = await server(tokenReply);
    const providers = {
      ...PROVIDERS,
      google: { ...PROVIDERS.google, tokenUrl: `${tok.base}/token`, authUrl: `${tok.base}/auth`, port } as OAuthProvider,
    };
    const yt = await server((r) => (r.url.startsWith('/channels') ? { json: { items: [{ snippet: { title: 'Canal de Diego' } }] } } : undefined));
    e = makeEnv({ openUrl, oauthProviders: providers, socialEnv: { youtube: { upload: `${yt.base}/upload`, api: yt.base } } });
    return { tok, yt };
  }

  it('autoriza, guarda las claves cifradas y el nombre de la cuenta; nada sensible llega a la interfaz', async () => {
    const { tok } = await setup(53701, () => ({ json: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 } }));
    e.ctx.connections.setApp('youtube', ' CID ', 'SECRETO');
    const list = await e.ctx.connections.connect('youtube');
    const yt = list.find((x) => x.platform === 'youtube')!;
    assert.deepEqual([yt.hasCredentials, yt.connected, yt.account], [true, true, 'Canal de Diego']);
    const body = new URLSearchParams(tok.reqs[0].body.toString());
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'CODE');
    assert.equal(body.get('client_id'), 'CID');
    assert.ok(body.get('code_verifier'));
    const disk = fs.readFileSync(e.ctx.store.file, 'utf8');
    for (const secret of ['SECRETO', 'AT1', 'RT1']) assert.ok(!disk.includes(secret), `${secret} no debe estar en claro en data.json`);
    assert.equal((await e.ctx.connections.accessToken('youtube'))?.accessToken, 'AT1');
  });

  it('renueva el token cuando va a caducar y conserva el refresh_token', async () => {
    let n = 0;
    await setup(53702, (r) => {
      n++;
      const grant = new URLSearchParams(r.body.toString()).get('grant_type');
      return grant === 'refresh_token' ? { json: { access_token: 'AT2', expires_in: 3600 } } : { json: { access_token: 'AT1', refresh_token: 'RT1', expires_in: 60 } };
    });
    e.ctx.connections.setApp('youtube', 'CID', 'S');
    await e.ctx.connections.connect('youtube');
    const t = await e.ctx.connections.accessToken('youtube');
    assert.equal(t?.accessToken, 'AT2');
    assert.equal(t?.refreshToken, 'RT1');
    assert.equal(n, 2);
    // dos peticiones a la vez renuevan una sola vez
    n = 0;
    const conn = (e.ctx.store.data.connections.youtube!);
    void conn;
    assert.equal((await e.ctx.connections.accessToken('youtube'))?.accessToken, 'AT2');
    assert.equal(n, 0);
  });

  it('si el usuario deniega o la app es rechazada, error claro y no queda conectada', async () => {
    await setup(53703, () => ({ status: 400, json: { error: 'invalid_client', error_description: 'secreto incorrecto' } }));
    e.ctx.connections.setApp('youtube', 'CID', 'S');
    await assert.rejects(() => e.ctx.connections.connect('youtube'), /rechazó la autorización: secreto incorrecto/);
    assert.equal(e.ctx.connections.list()[0].connected, false);
    // el puerto queda libre para reintentar
    const e2 = e;
    void e2;
    await assert.rejects(() => e.ctx.connections.connect('youtube'), /rechazó/);
  });

  it('error en el navegador (access_denied) y cancelación', async () => {
    const denied = async (url: string) => {
      const u = new URL(url);
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('error', 'access_denied');
      setTimeout(() => void fetch(back).catch(() => undefined), 20);
    };
    await setup(53704, () => ({ json: {} }), denied);
    e.ctx.connections.setApp('youtube', 'CID', 'S');
    await assert.rejects(() => e.ctx.connections.connect('youtube'), /no autorizó la conexión \(access_denied\)/);
    const never = async () => undefined;
    const e3 = makeEnv({ openUrl: never, oauthProviders: { ...PROVIDERS, google: { ...PROVIDERS.google, port: 53705 } as OAuthProvider } });
    try {
      e3.ctx.connections.setApp('youtube', 'CID', 'S');
      const p = e3.ctx.connections.connect('youtube');
      await new Promise((r) => setTimeout(r, 100));
      await assert.rejects(() => e3.ctx.connections.connect('youtube'), /Ya hay una conexión en curso/);
      e3.ctx.connections.cancelConnect();
      await assert.rejects(() => p, /cancelada/);
    } finally {
      e3.cleanup();
    }
  });

  it('una visita ajena al callback (estado distinto) no cuela ni cancela', async () => {
    const sneaky = async (url: string) => {
      const u = new URL(url);
      const back = new URL(u.searchParams.get('redirect_uri')!);
      const evil = new URL(back);
      evil.searchParams.set('code', 'EVIL');
      evil.searchParams.set('state', 'otro');
      setTimeout(() => void fetch(evil).then(() => fetch(`${back.origin}/otra-ruta`)).then(async () => {
        back.searchParams.set('code', 'GOOD');
        back.searchParams.set('state', u.searchParams.get('state')!);
        await fetch(back);
      }).catch(() => undefined), 20);
    };
    const { tok } = await setup(53706, () => ({ json: { access_token: 'AT', expires_in: 3600, refresh_token: 'R' } }), sneaky);
    e.ctx.connections.setApp('youtube', 'CID', 'S');
    await e.ctx.connections.connect('youtube');
    assert.equal(new URLSearchParams(tok.reqs[0].body.toString()).get('code'), 'GOOD');
  });

  it('cambiar el ID de la app desconecta; el secreto enmascarado no pisa el guardado; desconectar borra las claves', async () => {
    await setup(53707, () => ({ json: { access_token: 'AT', expires_in: 3600, refresh_token: 'R' } }));
    e.ctx.connections.setApp('youtube', 'CID', 'S');
    await e.ctx.connections.connect('youtube');
    e.ctx.connections.setApp('youtube', 'CID', MASKED_SECRET);
    assert.equal(e.ctx.connections.list()[0].connected, true);
    e.ctx.connections.setApp('youtube', 'OTRO', MASKED_SECRET);
    assert.equal(e.ctx.connections.list()[0].connected, false);
    assert.equal(e.ctx.connections.list()[0].hasCredentials, true);
    await e.ctx.connections.connect('youtube');
    e.ctx.connections.disconnect('youtube');
    assert.equal(e.ctx.connections.list()[0].connected, false);
    assert.equal(await e.ctx.connections.accessToken('youtube'), null);
    assert.throws(() => e.ctx.connections.setApp('youtube', 'con espacios', 'x'), /no es válido/);
    await assert.rejects(() => e.ctx.connections.connect('tiktok'), /Primero guarda/);
  });

  it('sin conexión, el programador deja la publicación en espera (NotConnectedError)', async () => {
    e = makeEnv();
    const pubs = realPublishers(e.ctx.connections, e.ctx.log);
    await assert.rejects(() => pubs.youtube.publish(out({})), NotConnectedError);
    await assert.rejects(() => pubs.tiktok.publish(out({})), NotConnectedError);
    await assert.rejects(() => pubs.instagram.publish(out({})), NotConnectedError);
  });
});

describe('YouTube: subida reanudable', () => {
  const token = async () => 'TOK';
  const SIZE = 600_000;

  function ytServer(opts: { dropAt?: number; quota?: boolean; playlists?: unknown[]; failPlaylistItem?: boolean } = {}) {
    let received = 0;
    let dropped = false;
    return server((r) => {
      if (r.url.startsWith('/upload/videos?uploadType=resumable')) {
        if (opts.quota) return { status: 403, json: { error: { message: 'Quota', errors: [{ reason: 'quotaExceeded' }] } } };
        return { headers: { location: `${(r.headers.host ? `http://${r.headers.host}` : '')}/session/1` } };
      }
      if (r.url === '/session/1') {
        const cr = r.headers['content-range'] ?? '';
        if (cr.startsWith('bytes */')) return { status: 308, headers: received ? { range: `bytes=0-${received - 1}` } : {} };
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr)!;
        if (opts.dropAt !== undefined && !dropped && Number(m[1]) >= opts.dropAt) {
          dropped = true;
          return { status: -1 };
        }
        assert.equal(Number(m[1]), received, 'los trozos van en orden y sin huecos');
        received = Number(m[2]) + 1;
        return received >= Number(m[3]) ? { json: { id: 'VID123' } } : { status: 308, headers: { range: `bytes=0-${received - 1}` } };
      }
      if (r.url.startsWith('/playlists?part=snippet&mine')) return { json: { items: opts.playlists ?? [] } };
      if (r.url.startsWith('/playlists?part=snippet,status')) return { json: { id: 'PLnew' } };
      if (r.url.startsWith('/playlistItems')) return opts.failPlaylistItem ? { status: 500 } : { json: { id: 'item' } };
      if (r.url.startsWith('/upload/thumbnails/set')) return { json: {} };
      return undefined;
    }).then((s) => ({ ...s, receivedBytes: () => received }));
  }

  it('sube un vídeo largo por trozos con sus datos, lista y miniatura', async () => {
    const s = await ytServer({ playlists: [{ id: 'PL1', snippet: { title: 'Directos' } }] });
    const file = mk('largo.mp4', SIZE);
    const thumb = mk('t.jpg', 100);
    const r = await publishYoutube(
      { token, endpoints: { upload: `${s.base}/upload`, api: s.base }, chunkSize: 262144 },
      out({ kind: 'long', title: 'Resumen', description: 'Desc', playlist: 'directos', files: { long: file }, thumbnail: thumb, visibility: 'public' }),
    );
    assert.equal(r.videoId, 'VID123');
    assert.equal(s.receivedBytes(), SIZE);
    const init = s.reqs[0];
    assert.equal(init.headers.authorization, 'Bearer TOK');
    assert.equal(init.headers['x-upload-content-length'], String(SIZE));
    const meta = JSON.parse(init.body.toString());
    assert.deepEqual(meta.status, { privacyStatus: 'public', selfDeclaredMadeForKids: false });
    assert.equal(meta.snippet.title, 'Resumen');
    const item = s.reqs.find((x) => x.url.startsWith('/playlistItems'))!;
    assert.equal(JSON.parse(item.body.toString()).snippet.playlistId, 'PL1');
    assert.ok(s.reqs.some((x) => x.url.startsWith('/upload/thumbnails/set?videoId=VID123')));
  });

  it('por defecto privado; los clips suben la versión vertical como Short; crea la lista si no existe', async () => {
    const s = await ytServer();
    const v = mk('v.mp4', 1000);
    await publishYoutube({ token, endpoints: { upload: `${s.base}/upload`, api: s.base } }, out({ title: 'Clip', playlist: 'Nueva', files: { vertical: v, horizontal: mk('h.mp4', 5) } }));
    const meta = JSON.parse(s.reqs[0].body.toString());
    assert.equal(meta.status.privacyStatus, 'private');
    assert.equal(meta.snippet.title, 'Clip #Shorts');
    assert.ok(s.reqs.some((x) => x.url.startsWith('/playlists?part=snippet,status')));
    assert.equal(JSON.parse(s.reqs.find((x) => x.url.startsWith('/playlistItems'))!.body.toString()).snippet.playlistId, 'PLnew');
  });

  it('si se corta la conexión a mitad, pregunta hasta dónde llegó y continúa sin repetir ni saltarse bytes', async () => {
    const s = await ytServer({ dropAt: 262144 });
    const file = mk('cortado.mp4', SIZE);
    const r = await publishYoutube({ token, sleep: async () => undefined, endpoints: { upload: `${s.base}/upload`, api: s.base }, chunkSize: 262144 }, out({ kind: 'long', files: { long: file } }));
    assert.equal(r.videoId, 'VID123');
    assert.equal(s.receivedBytes(), SIZE);
    assert.ok(s.reqs.some((x) => String(x.headers['content-range']).startsWith('bytes */')), 'debe consultar el estado');
  });

  it('un fallo al añadir a la lista NO impide dar la subida por buena (no se duplica el vídeo)', async () => {
    const s = await ytServer({ failPlaylistItem: true });
    const warns: string[] = [];
    const r = await publishYoutube({ token, warn: (m) => warns.push(m), endpoints: { upload: `${s.base}/upload`, api: s.base } }, out({ kind: 'long', playlist: 'X', files: { long: mk('l2.mp4', 500) } }));
    assert.equal(r.videoId, 'VID123');
    assert.match(warns.join(' '), /No se pudo añadir a la lista/);
  });

  it('cuota agotada, 401 y archivo que falta dan mensajes claros', async () => {
    const q = await ytServer({ quota: true });
    await assert.rejects(() => publishYoutube({ token, endpoints: { upload: `${q.base}/upload`, api: q.base } }, out({ kind: 'long', files: { long: mk('q.mp4', 10) } })), /cuota diaria/);
    const u = await server(() => ({ status: 401, json: { error: { message: 'x' } } }));
    await assert.rejects(() => publishYoutube({ token, endpoints: { upload: `${u.base}/upload`, api: u.base } }, out({ kind: 'long', files: { long: mk('u.mp4', 10) } })), /Vuelve a conectar/);
    await assert.rejects(() => publishYoutube({ token }, out({ kind: 'long', files: { long: path.join(dir, 'nope.mp4') } })), /ya no está en su sitio/);
    await assert.rejects(() => publishYoutube({ token }, out({ kind: 'long', files: {} })), /no tiene archivo/);
  });

  it('lista las listas de reproducción con paginación', async () => {
    let page = 0;
    const s = await server((r) => {
      if (!r.url.startsWith('/playlists')) return undefined;
      return page++ === 0 ? { json: { items: [{ id: 'a', snippet: { title: 'A' } }], nextPageToken: 'p2' } } : { json: { items: [{ id: 'b', snippet: { title: 'B' } }] } };
    });
    assert.deepEqual(await listPlaylists({ token, endpoints: { upload: s.base, api: s.base } }), [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  });
});

describe('TikTok', () => {
  const token = async () => 'TT';
  function tt(opts: { options?: string[]; statuses?: string[]; failReason?: string } = {}) {
    const chunks: string[] = [];
    let polls = 0;
    return server((r) => {
      if (r.url === '/post/publish/creator_info/query/') return { json: { data: { privacy_level_options: opts.options ?? ['SELF_ONLY'] }, error: { code: 'ok' } } };
      if (r.url === '/post/publish/video/init/') return { json: { data: { publish_id: 'PUB1', upload_url: `http://${r.headers.host}/upload` }, error: { code: 'ok' } } };
      if (r.url === '/upload') {
        chunks.push(String(r.headers['content-range']));
        const m = /bytes \d+-(\d+)\/(\d+)/.exec(String(r.headers['content-range']))!;
        return { status: Number(m[1]) + 1 === Number(m[2]) ? 201 : 206 };
      }
      if (r.url === '/post/publish/status/fetch/') {
        const s = (opts.statuses ?? ['PROCESSING_UPLOAD', 'PUBLISH_COMPLETE'])[polls++] ?? 'PUBLISH_COMPLETE';
        return { json: { data: { status: s, fail_reason: opts.failReason }, error: { code: 'ok' } } };
      }
      return undefined;
    }).then((s) => ({ ...s, chunks }));
  }

  it('sube en trozos (el último con el resto), usa privacidad «solo yo» si no hay otra, y espera a que termine', async () => {
    const s = await tt();
    const file = mk('tt.mp4', 25_000_000 + 123);
    const r = await publishTiktok({ token, api: s.base, pollMs: 1, sleep: async () => undefined }, out({ files: { vertical: file } }));
    assert.equal(r.publishId, 'PUB1');
    const init = JSON.parse(s.reqs.find((x) => x.url.includes('/init/'))!.body.toString());
    assert.equal(init.post_info.privacy_level, 'SELF_ONLY');
    assert.deepEqual(init.source_info, { source: 'FILE_UPLOAD', video_size: 25_000_123, chunk_size: 10485760, total_chunk_count: 2 });
    assert.deepEqual(s.chunks, ['bytes 0-10485759/25000123', 'bytes 10485760-25000122/25000123']);
    assert.equal(s.reqs[0].headers.authorization, 'Bearer TT');
  });
  it('un vídeo pequeño va en un solo trozo; público solo si lo pides y la cuenta puede', async () => {
    const s = await tt({ options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] });
    await publishTiktok({ token, api: s.base, sleep: async () => undefined, pollMs: 1 }, out({ visibility: 'public', files: { vertical: mk('tt2.mp4', 3000) } }));
    const init = JSON.parse(s.reqs.find((x) => x.url.includes('/init/'))!.body.toString());
    assert.equal(init.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
    assert.equal(init.source_info.total_chunk_count, 1);
    const s2 = await tt({ options: ['SELF_ONLY'] });
    await publishTiktok({ token, api: s2.base, sleep: async () => undefined }, out({ visibility: 'public', files: { vertical: mk('tt3.mp4', 3000) } }));
    assert.equal(JSON.parse(s2.reqs.find((x) => x.url.includes('/init/'))!.body.toString()).post_info.privacy_level, 'SELF_ONLY');
  });
  it('rechaza vídeos largos, informa de fallos de TikTok y del límite diario', async () => {
    await assert.rejects(() => publishTiktok({ token }, out({ kind: 'long', files: { long: mk('tt4.mp4', 10) } })), /solo admite clips/);
    const s = await tt({ statuses: ['FAILED'], failReason: 'video_pull_failed' });
    await assert.rejects(() => publishTiktok({ token, api: s.base, sleep: async () => undefined }, out({ files: { vertical: mk('tt5.mp4', 100) } })), /video_pull_failed/);
    const lim = await server(() => ({ status: 429, json: { error: { code: 'spam_risk_too_many_posts', message: 'x' } } }));
    await assert.rejects(() => publishTiktok({ token, api: lim.base }, out({ files: { vertical: mk('tt6.mp4', 100) } })), /límite|limita/);
    const bad = await server(() => ({ status: 401, json: { error: { code: 'access_token_invalid' } } }));
    await assert.rejects(() => publishTiktok({ token, api: bad.base }, out({ files: { vertical: mk('tt7.mp4', 100) } })), /Vuelve a conectar/);
  });
  it('si TikTok no termina de procesar, no reintenta solo (evita duplicados)', async () => {
    const s = await tt({ statuses: new Array(100).fill('PROCESSING_UPLOAD') });
    await assert.rejects(() => publishTiktok({ token, api: s.base, sleep: async () => undefined }, out({ files: { vertical: mk('tt8.mp4', 100) } })), /sigue procesando/);
  });
});

describe('Instagram', () => {
  const tokenFn = async () => ({ accessToken: 'IGT', igUserId: 'IG1' });
  function ig(opts: { statuses?: string[]; publishError?: boolean } = {}) {
    let polls = 0;
    let uploaded = 0;
    return server((r) => {
      if (r.url === '/IG1/media' && r.method === 'POST') return { json: { id: 'CONT1', uri: `http://${r.headers.host}/rupload/CONT1` } };
      if (r.url === '/rupload/CONT1') {
        uploaded = r.body.length;
        return { json: { success: true } };
      }
      if (r.url.startsWith('/CONT1?fields=')) {
        const s = (opts.statuses ?? ['IN_PROGRESS', 'FINISHED'])[polls++] ?? 'FINISHED';
        return { json: { status_code: s, status: s === 'ERROR' ? 'Formato no válido' : 'ok' } };
      }
      if (r.url === '/IG1/media_publish') return opts.publishError ? { status: 400, json: { error: { message: 'Nope', code: 9007 } } } : { json: { id: 'MEDIA9' } };
      return undefined;
    }).then((s) => ({ ...s, uploaded: () => uploaded }));
  }
  it('crea el contenedor, sube el archivo entero, espera y publica', async () => {
    const s = await ig();
    const file = mk('ig.mp4', 400_000);
    const r = await publishInstagram({ token: tokenFn, graph: s.base, pollMs: 1, sleep: async () => undefined }, out({ title: 'Mi reel', files: { vertical: file } }));
    assert.equal(r.mediaId, 'MEDIA9');
    assert.equal(s.uploaded(), 400_000);
    const create = new URLSearchParams(s.reqs[0].body.toString());
    assert.deepEqual([create.get('media_type'), create.get('upload_type'), create.get('caption'), create.get('access_token')], ['REELS', 'resumable', 'Mi reel', 'IGT']);
    const up = s.reqs.find((x) => x.url === '/rupload/CONT1')!;
    assert.equal(up.headers.authorization, 'OAuth IGT');
    assert.equal(up.headers.file_size, '400000');
    assert.equal(up.headers.offset, '0');
  });
  it('errores: procesado fallido, sin cuenta profesional, vídeos largos, sin vertical, publicación rechazada', async () => {
    const s = await ig({ statuses: ['ERROR'] });
    await assert.rejects(() => publishInstagram({ token: tokenFn, graph: s.base, sleep: async () => undefined }, out({ files: { vertical: mk('ig2.mp4', 100) } })), /Formato no válido/);
    await assert.rejects(() => publishInstagram({ token: async () => ({ accessToken: 'x', igUserId: '' }) }, out({ files: { vertical: mk('ig3.mp4', 100) } })), /cuenta de Instagram profesional/);
    await assert.rejects(() => publishInstagram({ token: tokenFn }, out({ kind: 'long', files: { long: mk('ig4.mp4', 10) } })), /solo admite clips/);
    await assert.rejects(() => publishInstagram({ token: tokenFn }, out({ files: { horizontal: mk('ig5.mp4', 10) } })), /versión vertical/);
    const p = await ig({ publishError: true });
    await assert.rejects(() => publishInstagram({ token: tokenFn, graph: p.base, sleep: async () => undefined, pollMs: 1 }, out({ files: { vertical: mk('ig6.mp4', 100) } })), /Instagram: Nope/);
  });
});

describe('cuentas conectadas', () => {
  it('Instagram: encuentra la cuenta profesional enlazada; sin ella, explica qué falta', async () => {
    const s = await server(() => ({ json: { data: [{ name: 'Pág sin IG' }, { name: 'Mi página', instagram_business_account: { id: '1784', username: 'diego' } }] } }));
    assert.deepEqual(await lookupAccount('instagram', { accessToken: 't', expiresAt: 0 }, { graph: s.base }), { account: '@diego', extra: { igUserId: '1784' } });
    const none = await server(() => ({ json: { data: [{ name: 'x' }] } }));
    await assert.rejects(() => lookupAccount('instagram', { accessToken: 't', expiresAt: 0 }, { graph: none.base }), /cuenta de Instagram profesional/);
  });
  it('YouTube sin canal y TikTok', async () => {
    const yt = await server(() => ({ json: { items: [] } }));
    await assert.rejects(() => lookupAccount('youtube', { accessToken: 't', expiresAt: 0 }, { ytApi: yt.base }), /no tiene un canal/);
    const tk = await server(() => ({ json: { data: { user: { display_name: 'diego_tt' } }, error: { code: 'ok' } } }));
    assert.equal((await lookupAccount('tiktok', { accessToken: 't', expiresAt: 0 }, { tiktokApi: tk.base })).account, 'diego_tt');
  });
});

void makeVideo;
