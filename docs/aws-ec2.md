# AWS EC2 Hosting Guide

This backend runs as a long-lived Node/Express process on EC2. Use PM2 or systemd to keep it alive, and put Nginx or an AWS load balancer in front for ports 80/443.

## Runtime

Use Node.js 20 or newer. The dependency tree includes packages that require Node 20+.

```bash
npm ci --omit=dev
cp .env.example .env
nano .env
```

Minimum production values:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=5000
PUBLIC_BASE_URL=https://api.example.com
TRUST_PROXY=true
CORS_ORIGINS=https://app.example.com
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/pattiya
MONGODB_REQUIRED=true
JWT_SECRET=replace_with_a_long_random_secret
JWT_REFRESH_SECRET=replace_with_a_different_long_random_secret
```

If InfluxDB or MQTT are not ready yet, keep the API online with:

```env
INFLUXDB_REQUIRED=false
MQTT_ENABLED=false
HEAT_CRON_ENABLED=false
```

Turn them back on after those services are reachable.

## PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup systemd
```

Useful checks:

```bash
pm2 status
pm2 logs pattiya-backend
curl http://127.0.0.1:5000/api/v1/health
```

## Nginx Reverse Proxy

Example `/etc/nginx/sites-available/pattiya-backend`:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Then enable it:

```bash
sudo ln -s /etc/nginx/sites-available/pattiya-backend /etc/nginx/sites-enabled/pattiya-backend
sudo nginx -t
sudo systemctl reload nginx
```

Open EC2 security group ports 80 and 443. Only open port 5000 directly for temporary debugging.

## Fix Nginx `connect() failed (111: Connection refused)`

This error means Nginx is running, but the Node backend is not accepting connections at the configured upstream, usually `127.0.0.1:5000`.

Run these on the EC2 instance:

```bash
cd /path/to/pattiya-backend-v1
npm run doctor:ec2
ss -ltnp | grep :5000
pm2 status
pm2 logs pattiya-backend --lines 100
```

Common fixes:

```bash
# Start or restart the backend
pm2 start ecosystem.config.cjs --env production
pm2 restart pattiya-backend --update-env

# Confirm Node is listening locally
curl http://127.0.0.1:5000/api/v1/health
curl http://127.0.0.1:5000/api/v1/ready

# Reload Nginx after proxy changes
sudo nginx -t
sudo systemctl reload nginx
```

If PM2 logs show `MONGODB_URI is required`, set `MONGODB_URI` in `.env`. For temporary debugging only, you can keep the HTTP health endpoint online while fixing MongoDB with:

```env
MONGODB_REQUIRED=false
```

When MongoDB is working, set it back to `true` in production.


## Socket.IO Notes

The backend accepts both `/socket.io` and `/api/socket.io` by default. The Flutter app uses `/socket.io` for EC2 hosts unless `SOCKET_IO_PATH` is set in the app environment.

If you see this in backend logs:

```text
GET /socket.io/?EIO=4&transport=websocket 404
```

then the request is reaching Express instead of Socket.IO. Check these first:

```bash
npm run doctor:ec2
pm2 logs pattiya-backend --lines 100
curl "http://127.0.0.1:5000/socket.io/?EIO=4&transport=polling"
curl "http://127.0.0.1:5000/api/socket.io/?EIO=4&transport=polling"
```

For websocket transport through Nginx, the proxy must use HTTP/1.1 and forward upgrade headers:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

After changing `.env` or pulling backend code, restart PM2 with:

```bash
pm2 restart pattiya-backend --update-env
```
