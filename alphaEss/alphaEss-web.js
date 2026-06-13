/**
 * alphaEss-web.js
 * Serveur HTTP embarqué — dashboard accessible depuis n'importe quel appareil du réseau
 */

import http from 'node:http';
import * as path from 'node:path';
import * as url from 'url';
import fs from 'fs-extra';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

let server = null;

// ─────────────────────────────────────────────
// Démarre le serveur HTTP
// ─────────────────────────────────────────────
export function startWebServer(port, getCachedData) {
    if (server) return;

    const htmlFile = path.resolve(__dirname, 'alphaEss-web.html');

    server = http.createServer((req, res) => {
        const reqUrl = url.parse(req.url).pathname;

        if (reqUrl === '/data') {
            // API JSON — données en temps réel
            const data = getCachedData();
            res.writeHead(200, {
                'Content-Type':                'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control':               'no-cache'
            });
            res.end(JSON.stringify(data));

        } else if (reqUrl === '/' || reqUrl === '/index.html') {
            // Page HTML principale
            try {
                const html = fs.readFileSync(htmlFile, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
            } catch(e) {
                res.writeHead(404);
                res.end('Dashboard HTML non trouvé');
            }

        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    server.listen(port, '0.0.0.0', () => {
        info(`alphaEss: Dashboard web disponible sur http://localhost:${port}`);
    });

    server.on('error', (e) => {
        error(`alphaEss: Erreur serveur web — ${e.message}`);
    });
}

// ─────────────────────────────────────────────
// Arrête le serveur HTTP
// ─────────────────────────────────────────────
export function stopWebServer() {
    if (server) {
        server.close();
        server = null;
        info('alphaEss: Serveur web arrêté');
    }
}
