/**
 * server.js
 * Dual HTTPS and HTTP local development and deployment server for Young's Double-Slit XR Laboratory.
 * 
 * Provides SSL termination required by Meta Quest 3/3S WebXR runtime permissions.
 * Streams GLTF/GLB models using HTTP Range headers.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT_HTTPS = 3443;
const PORT_HTTP = 3000;
const DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

function handleRequest(req, res) {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    // Decode URL and normalize path safely
    const decodedPath = decodeURIComponent(reqPath);
    const safePath = path.normalize(decodedPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + reqPath);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const totalSize = stats.size;

        // Support HTTP 206 Partial Content (Range requests for 3D GLB models)
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
            const chunkSize = (end - start) + 1;
            const stream = fs.createReadStream(filePath, { start, end });

            stream.on('error', () => { if (!res.headersSent) res.end(); });
            res.on('close', () => stream.destroy());

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            stream.pipe(res);
        } else {
            const stream = fs.createReadStream(filePath);
            stream.on('error', () => { if (!res.headersSent) res.end(); });
            res.on('close', () => stream.destroy());

            res.writeHead(200, {
                'Content-Length': totalSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            stream.pipe(res);
        }
    });
}

process.on('uncaughtException', (err) => {
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error('Server caught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('Server unhandled rejection:', reason);
});

// 1. Start HTTPS WebXR Server
let httpsServer = null;
try {
    const keyPath = path.join(DIR, 'key.pem');
    const certPath = path.join(DIR, 'cert.pem');
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };

        httpsServer = https.createServer(sslOptions, handleRequest);
        httpsServer.listen(PORT_HTTPS, '0.0.0.0', () => {
            const ip = getLocalIp();
            console.log('\n======================================================');
            console.log('🔒 HTTPS WebXR Server Active (Meta Quest 3 / 3S Ready)');
            console.log(`   👉 Quest 3/3S Browser:  https://${ip}:${PORT_HTTPS}`);
            console.log(`   👉 Laptop / Desktop:    https://localhost:${PORT_HTTPS}`);
            console.log('======================================================\n');
        });
    }
} catch (e) {
    console.error('Notice: HTTPS server initialization:', e.message);
}

// 2. Start HTTP Fallback Server
const httpServer = http.createServer(handleRequest);
httpServer.listen(PORT_HTTP, '0.0.0.0', () => {
    console.log(`🌐 HTTP Local Server: http://localhost:${PORT_HTTP}\n`);
});
