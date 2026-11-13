export interface StorageItem {
  id: string;
  label: string;
  bytes: number;
  note: string;
}

export interface StorageReport {
  items: StorageItem[];
  total: number;
  /** Lo que se libera con «Liberar espacio»: directos ya aprovechados y archivos temporales. */
  reclaimableBytes: number;
  reclaimableVods: number;
}

export interface StorageFreed {
  freedBytes: number;
  vods: number;
  temp: number;
}

/** 1,5 GB, 320 MB… */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
