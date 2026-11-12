/**
 * Biblioteca de piezas para portadas: PNG recortados (tú sorprendido, un logo), fondos, fotos y documentos de referencia.
 * Cada pieza tiene un nombre que eliges tú (Diego_Sorprendido, Fondo_Ciudad) y el programa compone las portadas con ellas.
 */
export const ASSET_KINDS = ['imagen', 'fondo', 'foto', 'documento', 'portada'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const KIND_LABEL: Record<AssetKind, string> = {
  imagen: 'Imagen (PNG, recorte)',
  fondo: 'Fondo',
  foto: 'Foto',
  documento: 'Documento',
  portada: 'Portada hecha',
};

export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;
export const DOC_EXT = ['.pdf', '.txt', '.md', '.doc', '.docx', '.odt'] as const;
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const NAME_MAX = 40;
/** Máximo de palabras y de letras de la frase de una portada compuesta. */
export const PHRASE_MAX_WORDS = 4;
export const PHRASE_MAX_CHARS = 28;

export interface CoverAsset {
  id: string;
  name: string;
  kind: AssetKind;
  ext: string;
  bytes: number;
  addedAt: number;
  /** Se puede enseñar y usar como imagen (no es un documento). */
  isImage: boolean;
}

export interface ComposeOpts {
  /** Fondo de la portada (cualquier imagen de la biblioteca). */
  backgroundId: string;
  /** Pieza que va grande a la derecha (normalmente un PNG recortado de ti). */
  subjectId?: string;
  /** Frase grande: 1 a 4 palabras. */
  text?: string;
  /** Número de episodio o día, grande en una esquina. */
  badge?: number | null;
  /** Nombre con el que se guarda la portada. */
  name?: string;
}

export const extOf = (fileName: string): string => {
  const m = /(\.[A-Za-z0-9]{1,5})$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : '';
};
export const isImageExt = (ext: string): boolean => (IMAGE_EXT as readonly string[]).includes(ext.toLowerCase());
export const isDocExt = (ext: string): boolean => (DOC_EXT as readonly string[]).includes(ext.toLowerCase());
export const isAssetKind = (v: unknown): v is AssetKind => typeof v === 'string' && (ASSET_KINDS as readonly string[]).includes(v);

/** Nombre limpio: letras, números, guion y guion bajo (los espacios pasan a guion bajo), sin extensión, hasta 40 caracteres. */
export function cleanAssetName(raw: string): string {
  const base = raw.trim().replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const name = base
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/_{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, NAME_MAX);
  return name || 'Sin_nombre';
}

/** Si el nombre ya existe (sin mirar mayúsculas) le añade _2, _3… */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLocaleLowerCase('es')));
  if (!used.has(name.toLocaleLowerCase('es'))) return name;
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const cand = `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (!used.has(cand.toLocaleLowerCase('es'))) return cand;
  }
  return `${name.slice(0, NAME_MAX - 5)}_${Date.now() % 10000}`;
}

/** Tipo que se supone al soltar un archivo (se puede cambiar después): por la extensión y por palabras del nombre. */
export function guessKind(fileName: string): AssetKind {
  const ext = extOf(fileName);
  if (isDocExt(ext)) return 'documento';
  if (/(^|[\s_-])(fondo|background|bg|escenario)([\s_.-]|$)/i.test(fileName)) return 'fondo';
  if (/(^|[\s_-])(foto|photo|captura)([\s_.-]|$)/i.test(fileName)) return 'foto';
  return 'imagen';
}

/** Frase de la portada: mayúsculas, sin signos raros, hasta 4 palabras y 28 letras. */
export function cleanPhrase(raw: string): string {
  const words = raw
    .replace(/[^\p{L}\p{N}%$€'’.!?¡¿ -]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const next = [...out, w].join(' ');
    if (out.length >= PHRASE_MAX_WORDS || next.length > PHRASE_MAX_CHARS) break;
    out.push(w);
  }
  return out.join(' ').toLocaleUpperCase('es');
}
