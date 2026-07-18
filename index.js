const http = require('http');
const app = require('./src/app');
const { initSocketServer } = require('./src/services/socketService');

const server = http.createServer(app);

initSocketServer(server, {
    path: process.env.SOCKET_IO_PATH || '/api/socket.io',
});

module.exports = server;
module.exports.default = server;