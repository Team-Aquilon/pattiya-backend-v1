FROM node:20-alpine

WORKDIR /app

# Install dependencies (layer cached)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Expose server port
EXPOSE 5000

# Run node directly (bypasses docker-entrypoint wrapper)
ENTRYPOINT ["node"]
CMD ["src/server.js"]
