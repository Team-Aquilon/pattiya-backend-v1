const http = require('http');
const app = require('./app');
const { initSocketServer } = require('./services/socketService');

function normalizeVercelUrl(req) {
    if (!req || !req.url) return;

    if (req.url === '/v1' || req.url.startsWith('/v1/')) {
        req.url = `/api${req.url}`;
        return;
    }

    if (
        req.url === '/socket.io' ||
        req.url.startsWith('/socket.io/') ||
        req.url.startsWith('/socket.io?')
    ) {
        req.url = `/api${req.url}`;
    }
}

const server = http.createServer((req, res) => {
    app(req, res);
});

initSocketServer(server, {
    path: process.env.SOCKET_IO_PATH || '/api/socket.io',
});

server.prependListener('request', normalizeVercelUrl);
server.prependListener('upgrade', normalizeVercelUrl);

module.exports = server;