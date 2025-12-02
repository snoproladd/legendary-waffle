
# ---- Stage 1: Build ----
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# No build step needed for Express/EJS, but keep placeholder
RUN npm run build || echo "No build step"

# ---- Stage 2: Production ----
FROM node:18-alpine AS production

WORKDIR /app

# Copy only necessary files from build stage
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/index.js ./index.js
COPY --from=build /app/views ./views
COPY --from=build /app/public ./public
COPY --from=build /app/types ./types

# Set environment variables
ENV NODE_ENV=production
ENV PORT=80

# Expose port
EXPOSE 80

# Health check (optional)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

# Start the app
CMD ["npm", "start"]
