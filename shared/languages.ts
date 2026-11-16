/**
 * Idioma de los directos y vídeos del canal (desde la v0.39.0). Se elige en Ajustes › Piloto automático › Cómo edita y
 * llega a TODAS las IAs (editores, cronista, valoración, títulos, visión) como una nota en su encargo: así entienden la
 * transcripción en ese idioma y escriben los títulos y descripciones en él. También fija el idioma de Whisper.
 */
export interface StreamLanguage {
  id: string;
  /** Cómo se nombra en la nota para las IAs y en el selector. */
  label: string;
  /** Código de idioma para Whisper ('' = que lo detecte). */
  whisper: string;
}

export const STREAM_LANGUAGES: StreamLanguage[] = [
  { id: 'es-ES', label: 'español de España (castellano)', whisper: 'es' },
  { id: 'es-419', label: 'español de Latinoamérica', whisper: 'es' },
  { id: 'en', label: 'inglés', whisper: 'en' },
  { id: 'ca', label: 'catalán', whisper: 'ca' },
  { id: 'gl', label: 'gallego', whisper: 'gl' },
  { id: 'eu', label: 'euskera', whisper: 'eu' },
  { id: 'pt', label: 'portugués', whisper: 'pt' },
  { id: 'fr', label: 'francés', whisper: 'fr' },
  { id: 'it', label: 'italiano', whisper: 'it' },
  { id: 'de', label: 'alemán', whisper: 'de' },
  { id: 'multi', label: 'varios idiomas', whisper: '' },
];

export const DEFAULT_STREAM_LANGUAGE = 'es-ES';

export const streamLanguage = (id: string | undefined): StreamLanguage => STREAM_LANGUAGES.find((l) => l.id === id) ?? STREAM_LANGUAGES[0];

/** La nota de idioma que se añade al encargo de cada IA. */
export function languageNote(id: string | undefined): string {
  const l = streamLanguage(id);
  if (l.id === 'multi') {
    return ' IDIOMA DEL CANAL: en los directos se habla en varios idiomas. Entiende cada parte en su idioma y escribe los títulos, las descripciones y cualquier texto para el espectador en el idioma principal del directo. Los nombres de los campos del JSON no se traducen.';
  }
  if (l.id === DEFAULT_STREAM_LANGUAGE) {
    return ' IDIOMA DEL CANAL: en los directos y vídeos se habla español de España; escribe los títulos, las descripciones y cualquier texto para el espectador en castellano de España, sin latinismos.';
  }
  return ` IDIOMA DEL CANAL (manda sobre cualquier otra indicación de idioma de estas instrucciones): en los directos y vídeos se habla ${l.label}. Entiende la transcripción en ese idioma y escribe los títulos, las descripciones y cualquier texto para el espectador en ${l.label}. Los nombres de los campos del JSON no se traducen.`;
}
