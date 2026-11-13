import type { ReactNode } from 'react';

/** Instrucciones desplegables, paso a paso, para conseguir las claves de cada servicio. */
export default function KeyGuide({ title, steps, note, testId }: { title: string; steps: ReactNode[]; note?: ReactNode; testId?: string }) {
  return (
    <details className="howto" data-testid={testId}>
      <summary>{title}</summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {note && <div className="muted small" style={{ marginTop: 6 }}>{note}</div>}
    </details>
  );
}

export const TWITCH_STEPS: ReactNode[] = [
  <>Abre <code>dev.twitch.tv/console</code> e inicia sesión con tu cuenta de Twitch. Si no la tienes, activa antes la verificación en dos pasos en Twitch (Ajustes › Seguridad): la pide para crear apps.</>,
  <>Pulsa <strong>Registrar tu aplicación</strong> (Register Your Application).</>,
  <>Nombre: el que quieras (por ejemplo StreamClips-tu-canal; debe ser único). URL de redirección OAuth: <code>http://localhost</code>. Categoría: <em>Application Integration</em>. Tipo de cliente: <em>Confidential</em>.</>,
  <>Pulsa <strong>Crear</strong> y, en la lista, <strong>Administrar</strong> (Manage) junto a tu app.</>,
  <>Copia el <strong>ID de cliente</strong> y pégalo abajo en «Client ID».</>,
  <>Pulsa <strong>Nuevo secreto</strong> (New Secret), copia el valor al momento (no se vuelve a mostrar) y pégalo en «Client Secret».</>,
  <>Escribe el nombre de tu canal y pulsa «Guardar y probar conexión».</>,
];
