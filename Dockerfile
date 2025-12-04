
FROM node:18-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Runtime env
ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

# Alpine needs curl for healthcheck
RUN apk add --no-cache curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:80/health || exit 1

# Run Node directly (cleaner than npm start in containers)
CMD ["node", "index.js"]
