import fs from 'node:fs';
import path from 'node:path';
import { buildTables, indexText, toCsv, type DbSnapshot } from '../../shared/databaseTables';

export interface DatabaseTableInfo {
  name: string;
  file: string;
  rows: number;
  about: string;
}

/**
 * Base de datos de StreamClips en una carpeta: una tabla (CSV) por tipo de cosa, conectadas por identificadores,
 * y un índice que lo explica. Solo reescribe lo que ha cambiado.
 */
export class DatabaseWriter {
  private last = new Map<string, string>();
  private info: DatabaseTableInfo[] = [];
  constructor(
    readonly dir: string,
    private snapshot: () => Promise<DbSnapshot> | DbSnapshot,
    /** Tablas que escribe otro servicio dentro de esta carpeta (p. ej. las notas de los clips). */
    private external: () => { name: string; file: string; about: string; rows: number }[] = () => [],
  ) {}

  tables(): DatabaseTableInfo[] {
    return this.info;
  }

  async refresh(): Promise<DatabaseTableInfo[]> {
    const tables = buildTables(await this.snapshot());
    fs.mkdirSync(this.dir, { recursive: true });
    const put = (file: string, text: string) => {
      if (this.last.get(file) === text) return;
      fs.writeFileSync(path.join(this.dir, file), text);
      this.last.set(file, text);
    };
    const ext = this.external();
    for (const t of tables) put(`${t.name}.csv`, toCsv(t));
    put('Índice.md', indexText(tables, ext.map((e) => ({ name: e.name, about: e.about, rows: e.rows }))));
    this.info = [...ext.map((e) => ({ name: e.name, file: e.file, rows: e.rows, about: e.about })), ...tables.map((t) => ({ name: t.name, file: `${t.name}.csv`, rows: t.rows.length, about: t.about }))];
    return this.info;
  }
}
