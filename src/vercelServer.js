const http = require('http');
const app = require('./app');
const { initSocketServer } = require('./services/socketService');

function normalizeVercelUrl(req) {
    if (!req || !req.url) return;

    if (req.url === '/v1' || req.url.startsWith('/v1/')) {
        req.url = `/api${req.url}`;
    }
}

function setCorsHeaders(req, res) {
    const origin = req.headers.origin || '*';
    const requestedHeaders = req.headers['access-control-request-headers'];

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        requestedHeaders || 'Content-Type, Authorization, X-Gateway-Token'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
}

const server = http.createServer((req, res) => {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    app(req, res);
});

initSocketServer(server, {
    path: process.env.SOCKET_IO_PATH || '/api/socket.io',
});

server.prependListener('request', normalizeVercelUrl);
server.prependListener('upgrade', normalizeVercelUrl);

module.exports = server;