import type { Platform } from '../../shared/types';

export const PLATFORM_NAME: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

/** Logotipo de cada red (formas propias y sencillas; el color lo pone el CSS según esté encendida o apagada). */
export function PlatformIcon({ id, size = 22 }: { id: Platform; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const;
  if (id === 'youtube') {
    return (
      <svg {...common}>
        <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="currentColor" />
        <polygon points="10 8.8 16 12 10 15.2" fill="var(--ps-cut, #fff)" />
      </svg>
    );
  }
  if (id === 'tiktok') {
    return (
      <svg {...common}>
        <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="currentColor" />
        <path d="M13.2 5.5v8.2a2.3 2.3 0 1 1-2.3-2.3m2.3-5.9c.3 1.9 1.5 3.1 3.6 3.3" fill="none" stroke="var(--ps-cut, #fff)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="currentColor" />
      <circle cx="12" cy="12" r="4.6" fill="none" stroke="var(--ps-cut, #fff)" strokeWidth="1.9" />
      <circle cx="17.6" cy="6.4" r="1.25" fill="var(--ps-cut, #fff)" />
    </svg>
  );
}

/**
 * Interruptor de una red: su logotipo se ilumina con el color de la red cuando el vídeo se sube ahí y se apaga cuando no.
 * Es una casilla de verdad (accesible por teclado y para lectores de pantalla), con el logotipo como cara.
 */
export function PlatformSwitch(props: { id: Platform; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; title?: string; withLabel?: boolean; label?: string }) {
  const name = props.label ?? PLATFORM_NAME[props.id];
  return (
    <label className={`psw ${props.id} ${props.checked ? 'on' : 'off'} ${props.disabled ? 'dis' : ''}`} title={props.title ?? `${name}: ${props.checked ? 'se sube aquí' : 'no se sube aquí'}`}>
      <input type="checkbox" aria-label={name} checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="psw-face"><PlatformIcon id={props.id} /></span>
      {props.withLabel !== false && <span className="psw-name" aria-hidden="true">{name}</span>}
    </label>
  );
}

/** Las tres redes de un vistazo, sin interacción: encendidas las que tienen subida, apagadas las demás. */
export function PlatformDots(props: { platforms: Platform[]; all?: readonly Platform[]; size?: number }) {
  const all: readonly Platform[] = props.all ?? ['youtube', 'tiktok', 'instagram'];
  return (
    <span className="pdots" role="img" aria-label={all.map((p) => `${PLATFORM_NAME[p]} ${props.platforms.includes(p) ? 'sí' : 'no'}`).join(', ')}>
      {all.map((p) => (
        <span key={p} className={`pdot ${p} ${props.platforms.includes(p) ? 'on' : 'off'}`} title={`${PLATFORM_NAME[p]}: ${props.platforms.includes(p) ? 'se sube' : 'no se sube'}`}>
          <PlatformIcon id={p} size={props.size ?? 15} />
        </span>
      ))}
    </span>
  );
}
