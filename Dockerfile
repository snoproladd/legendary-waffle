
# ---- Stage 1: Build ----
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Run build step (if you have one, e.g., TypeScript or React)
RUN npm run build

# ---- Stage 2: Production ----
FROM node:18-alpine AS production

WORKDIR /app

# Copy only necessary files from build stage
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# If no dist folder, copy your app files:
# COPY --from=build /app/index.js ./index.js
# COPY --from=build /app/views ./views

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

CMD ["npm", "start"]
