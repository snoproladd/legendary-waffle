
# ---- Stage 1: Build ----
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files and install all deps (build tools included)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# If you have a real build step (e.g., TypeScript):
# RUN npm run build
# If not, keep this as a no-op or remove it to avoid confusion
# RUN npm run build || echo "No build step"

# ---- Stage 2: Production ----
FROM node:18-alpine AS production

WORKDIR /app

# Copy only what's needed for runtime
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app artifacts (built files if you have them)
COPY --from=build /app/index.js ./index.js
COPY --from=build /app/views ./views
COPY --from=build /app/public ./public
COPY --from=build /app/types ./types
# If you emit a /dist from a build step, copy that instead:
# COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

RUN apk add --no-cache curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:80/health || exit 1

# Start directly with Node
CMD ["node", "index.js"]
