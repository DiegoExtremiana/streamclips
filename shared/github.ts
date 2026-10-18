/** Dueño por defecto de los repositorios de la nube y del motor (el mismo del programa). */
export const GITHUB_OWNER = 'DiegoExtremiana';
export const CLOUD_REPO_NAME = 'streamclips-nube';
export const ENGINE_REPO_NAME = 'streamclips-motor';
export const DEFAULT_CLOUD_REPO = `${GITHUB_OWNER}/${CLOUD_REPO_NAME}`;
export const DEFAULT_ENGINE_REPO = `${GITHUB_OWNER}/${ENGINE_REPO_NAME}`;

/** Crear un repositorio con el nombre y la visibilidad ya puestos. */
export function newRepoUrl(name: string, visibility: 'private' | 'public'): string {
  return `https://github.com/new?name=${encodeURIComponent(name)}&visibility=${visibility}`;
}

/** Crear un token de acceso (fine-grained) con nombre y permisos ya puestos; solo falta elegir el repositorio y pulsar crear. */
export function newTokenUrl(name: string): string {
  const q = new URLSearchParams({
    name: name.slice(0, 40),
    description: 'Lo usa StreamClips para publicar y editar con el PC apagado.',
    expires_in: '366',
    contents: 'write',
    actions: 'write',
    secrets: 'write',
    workflows: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${q.toString()}`;
}
