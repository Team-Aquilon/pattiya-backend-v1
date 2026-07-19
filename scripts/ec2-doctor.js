const http = require('http');
const net = require('net');
const config = require('../src/config');

const targetHost = config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host;
const targetPort = config.server.port;

function envStatus(name, options = {}) {
    const value = process.env[name];
    if (value) return 'set';
    return options.required ? 'missing' : 'not set';
}

function normalizeSocketPath(value) {
    if (!value) return null;
    let socketPath = String(value).trim();
    if (!socketPath) return null;
    if (!socketPath.startsWith('/')) socketPath = `/${socketPath}`;
    return socketPath.replace(/\/+$/, '') || '/socket.io';
}

function configuredSocketPaths() {
    const aliases = process.env.SOCKET_IO_ALIASES === undefined
        ? ['/api/socket.io']
        : process.env.SOCKET_IO_ALIASES.split(',').map(normalizeSocketPath).filter(Boolean);
    return [...new Set([
        normalizeSocketPath(process.env.SOCKET_IO_PATH || '/socket.io'),
        '/socket.io',
        ...aliases,
    ].filter(Boolean))];
}

function checkTcp(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);

        socket.once('connect', () => {
            socket.destroy();
            resolve({ ok: true });
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve({ ok: false, code: 'TIMEOUT' });
        });
        socket.once('error', (err) => {
            resolve({ ok: false, code: err.code || 'ERROR', message: err.message });
        });

        socket.connect(port, host);
    });
}

function checkHttpPath(host, port, path) {
    return new Promise((resolve) => {
        const req = http.get({ host, port, path, timeout: 5000 }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body }));
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, code: 'TIMEOUT' });
        });
        req.on('error', (err) => resolve({ ok: false, code: err.code || 'ERROR', message: err.message }));
    });
}

async function main() {
    const socketPaths = configuredSocketPaths();

    console.log('Pattiya EC2 doctor');
    console.log('==================');
    console.log(`Node version       : ${process.version}`);
    console.log(`NODE_ENV           : ${config.server.env}`);
    console.log(`Configured host    : ${config.server.host}`);
    console.log(`Configured port    : ${targetPort}`);
    console.log(`Nginx upstream test: http://${targetHost}:${targetPort}/api/v1/health`);
    console.log(`Socket.IO paths    : ${socketPaths.join(', ')}`);
    console.log('');

    console.log('Environment');
    console.log(`  MONGODB_URI        : ${envStatus('MONGODB_URI', { required: config.mongo.required })}`);
    console.log(`  MONGODB_REQUIRED   : ${config.mongo.required}`);
    console.log(`  JWT_SECRET         : ${envStatus('JWT_SECRET', { required: true })}`);
    console.log(`  JWT_REFRESH_SECRET : ${envStatus('JWT_REFRESH_SECRET', { required: true })}`);
    console.log(`  INFLUXDB_TOKEN     : ${envStatus('INFLUXDB_TOKEN')}`);
    console.log(`  MQTT_ENABLED       : ${config.mqtt.enabled}`);
    console.log(`  HEAT_CRON_ENABLED  : ${config.heatCron.enabled}`);
    console.log('');

    const tcp = await checkTcp(targetHost, targetPort);
    if (!tcp.ok) {
        console.log(`TCP check          : failed (${tcp.code || tcp.message})`);
        console.log('');
        console.log('Nothing is listening on the Nginx upstream port. On EC2, run:');
        console.log('  pm2 status');
        console.log('  pm2 logs pattiya-backend --lines 100');
        console.log('  ss -ltnp | grep :' + targetPort);
        console.log('  cd /path/to/pattiya-backend-v1 && npm run start');
        console.log('');
        console.log('If npm start exits immediately, fix the .env values shown above, then restart PM2.');
        process.exitCode = 1;
        return;
    }

    console.log('TCP check          : ok');

    const health = await checkHttpPath(targetHost, targetPort, '/api/v1/health');
    if (!health.ok) {
        console.log(`HTTP health        : failed (${health.statusCode || health.code || health.message})`);
        if (health.body) console.log(`Response body      : ${health.body}`);
        process.exitCode = 1;
        return;
    }

    console.log(`HTTP health        : ok (${health.statusCode})`);
    if (health.body) console.log(`Response body      : ${health.body}`);

    let socketOk = false;
    for (const socketPath of socketPaths) {
        const probePath = `${socketPath}/?EIO=4&transport=polling&t=ec2doctor`;
        const result = await checkHttpPath(targetHost, targetPort, probePath);
        const label = `Socket.IO ${socketPath}`.padEnd(20);
        if (result.ok && result.body.startsWith('0')) {
            socketOk = true;
            console.log(`${label}: ok (${result.statusCode})`);
        } else {
            console.log(`${label}: failed (${result.statusCode || result.code || result.message})`);
        }
    }

    if (!socketOk) {
        console.log('');
        console.log('Socket.IO did not answer on any expected path. Restart PM2 after pulling the latest code:');
        console.log('  pm2 restart pattiya-backend --update-env');
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('Doctor failed:', err.message || err);
    process.exit(1);
});
