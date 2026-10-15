import type { ReactNode } from 'react';

/** Iconos de trazo (sin emoticonos). Heredan el color del texto y son decorativos: el botón lleva su aria-label. */
function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

type P = { size?: number };
export const IconPlay = (p: P) => <Svg {...p}><polygon points="7 4 20 12 7 20 7 4" fill="currentColor" /></Svg>;
export const IconPause = (p: P) => <Svg {...p}><rect x="6" y="4" width="4" height="16" fill="currentColor" /><rect x="14" y="4" width="4" height="16" fill="currentColor" /></Svg>;
export const IconRestart = (p: P) => <Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 3 3 9 9 9" /></Svg>;
export const IconVolume = (p: P) => <Svg {...p}><polygon points="4 9 8 9 13 5 13 19 8 15 4 15 4 9" fill="currentColor" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></Svg>;
export const IconMute = (p: P) => <Svg {...p}><polygon points="4 9 8 9 13 5 13 19 8 15 4 15 4 9" fill="currentColor" /><line x1="17" y1="9" x2="22" y2="14" /><line x1="22" y1="9" x2="17" y2="14" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" /></Svg>;
export const IconLibrary = (p: P) => <Svg {...p}><rect x="3" y="4" width="4" height="16" rx="1" /><rect x="9" y="4" width="4" height="16" rx="1" /><path d="M15.5 5.5l3.8-1 3 14.2-3.8 1-3-14.2z" /></Svg>;
export const IconFilm = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="7" y1="4" x2="7" y2="20" /><line x1="17" y1="4" x2="17" y2="20" /><line x1="3" y1="12" x2="21" y2="12" /></Svg>;
export const IconMore = (p: P) => <Svg {...p}><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><polyline points="9 6 15 12 9 18" /></Svg>;
export const IconPanel = (p: P) => <Svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>;
export const IconScissors = (p: P) => <Svg {...p}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.1" y2="15.9" /><line x1="14.5" y1="14.5" x2="20" y2="20" /><line x1="8.1" y1="8.1" x2="12" y2="12" /></Svg>;
export const IconLink = (p: P) => <Svg {...p}><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" /></Svg>;
export const IconSettings = (p: P) => <Svg {...p}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /><circle cx="9" cy="6" r="2.2" fill="var(--sidebar)" /><circle cx="15" cy="12" r="2.2" fill="var(--sidebar)" /><circle cx="8" cy="18" r="2.2" fill="var(--sidebar)" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 3v12" /><polyline points="7 11 12 16 17 11" /><path d="M4 20h16" /></Svg>;
export const IconLogo = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="4" /><polygon points="10 9 16 12 10 15 10 9" fill="currentColor" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Svg>;
export const IconCalendar = (p: P) => <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><polyline points="5 12.5 10 17.5 19 7" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Svg>;
