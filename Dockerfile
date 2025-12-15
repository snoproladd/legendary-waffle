
# Debian (trixie) Node 24 base
FROM node:24-trixie-slim

# Workdir
WORKDIR /app

# Install production deps first for layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Runtime env
ENV NODE_ENV=production
ENV PORT=80

# Expose app port and SSH port
EXPOSE 80 2222

# --- Debian packages for healthcheck & SSH ---
# curl for healthcheck; openssh-server for App Service SSH
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl openssh-server \
 && rm -rf /var/lib/apt/lists/*

# Prepare SSH config/state under /home (persisted on App Service)
RUN mkdir -p /home/etc/ssh /home/var/run/sshd \
 && printf "Port 2222\nListenAddress 0.0.0.0\nProtocol 2\nHostKey /home/etc/ssh/ssh_host_rsa_key\nPermitRootLogin prohibit-password\nPasswordAuthentication no\nChallengeResponseAuthentication no\nUsePAM no\nAllowTcpForwarding yes\nGatewayPorts no\nX11Forwarding no\nSubsystem sftp /usr/lib/openssh/sftp-server\n" > /home/etc/ssh/sshd_config \
 && ssh-keygen -t rsa -b 4096 -f /home/etc/ssh/ssh_host_rsa_key -N ""

# Healthcheck (your original intent, now using curl on Debian)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:80/health || exit 1

# Startup: run sshd (port 2222) in background, then start Node
# Keep Node as PID 1 via exec; simple and App Service-friendly
RUN printf "#!/bin/sh\nset -e\n/usr/sbin/sshd -D -f /home/etc/ssh/sshd_config -pRUN printf "#!/bin/sh\nset -e\n/usr/sbin/sshd -D -f /home/etc/ssh/sshd_config -p 2222 &\nexec node index.js\n" > /home/startup.sh \
 && chmod +x /home/startup.sh

