"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ENGINE_REPO = exports.DEFAULT_CLOUD_REPO = exports.ENGINE_REPO_NAME = exports.CLOUD_REPO_NAME = exports.GITHUB_OWNER = void 0;
exports.newRepoUrl = newRepoUrl;
exports.newTokenUrl = newTokenUrl;
/** Dueño por defecto de los repositorios de la nube y del motor (el mismo del programa). */
exports.GITHUB_OWNER = 'DiegoExtremiana';
exports.CLOUD_REPO_NAME = 'streamclips-nube';
exports.ENGINE_REPO_NAME = 'streamclips-motor';
exports.DEFAULT_CLOUD_REPO = `${exports.GITHUB_OWNER}/${exports.CLOUD_REPO_NAME}`;
exports.DEFAULT_ENGINE_REPO = `${exports.GITHUB_OWNER}/${exports.ENGINE_REPO_NAME}`;
/** Crear un repositorio con el nombre y la visibilidad ya puestos. */
function newRepoUrl(name, visibility) {
    return `https://github.com/new?name=${encodeURIComponent(name)}&visibility=${visibility}`;
}
/** Crear un token de acceso (fine-grained) con nombre y permisos ya puestos; solo falta elegir el repositorio y pulsar crear. */
function newTokenUrl(name) {
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
