import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Política de seguridad de contenido solo en producción. En desarrollo, el plugin de React
 * inyecta scripts en línea y una política estricta rompería la recarga en caliente.
 */
function productionCsp(): Plugin {
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: sc-media: https://*.twitch.tv https://*.twitchcdn.net https://*.jtvnw.net; media-src 'self' sc-media: https://*.twitch.tv https://*.twitchcdn.net https://*.jtvnw.net https://*.cloudfront.net https://*.ttvnw.net; connect-src 'self'";
  return {
    name: 'production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), productionCsp()],
  base: './',
  build: { outDir: 'dist' },
  server: { port: 5173, strictPort: true },
});
