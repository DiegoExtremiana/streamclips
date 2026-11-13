/** Un momento candidato en la pantalla de revisión. */
export interface MomentRow {
  /** Identificador estable (inicio redondeado del candidato). */
  key: string;
  start: number;
  end: number;
  /** Nota de entretenimiento 0-10. */
  total: number;
  kind: string;
  reason: string;
  title: string;
  /** Lo que se dice en el tramo, para juzgarlo sin verlo. */
  text: string;
  /** Entró en la última selección del piloto. */
  chosen: boolean;
  excluded: boolean;
  pinned: boolean;
  /** Tiene un recorte hecho a mano. */
  edited: boolean;
  /** Lo añadiste tú. */
  manual: boolean;
  /** No llegaba a la nota mínima. */
  belowFloor: boolean;
}

export interface MomentsView {
  /** Hay una selección guardada (el directo ya se analizó con selección inteligente). */
  available: boolean;
  quality: number | null;
  rows: MomentRow[];
  /** Hay correcciones tuyas que se aplicarán al volver a generar. */
  pending: boolean;
}

/** Lo que el programa ha aprendido de tus decisiones al revisar momentos. */
export interface PrefsView {
  enabled: boolean;
  kinds: { kind: string; bias: number; count: number; active: boolean }[];
}
