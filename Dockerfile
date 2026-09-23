FROM node:20-alpine

WORKDIR /app

# Install dependencies (layer cached)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Expose server port
EXPOSE 5000

# Start the server
CMD ["node", "src/server.js"]
