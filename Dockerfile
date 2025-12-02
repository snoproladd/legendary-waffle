
# Use an official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first for efficient caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the app
COPY . .

# Set environment variable for PORT (Azure expects this)
ENV PORT=80

# Expose the port
EXPOSE 80

# Health check (optional but recommended)
# This checks if your app responds on /health every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

# Start the app
CMD ["npm", "start"]
