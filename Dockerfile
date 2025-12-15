
# Debian Node 24
FROM node:24-trixie-slim

# Workdir
WORKDIR /app

# Install production deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Runtime env
ENV NODE_ENV=production
ENV PORT=80

# Expose app + SSH ports
EXPOSE 80 2222

# Debian packages: curl (healthcheck) + openssh-server (for App Service SSH)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl openssh-server \
 && rm -rf /var/lib/apt/lists/*

# Prepare SSH config/state under /home (persisted volume on App Service)
RUN mkdir -p /home/etc/ssh /home/var/run/sshd \
 && printf "Port 2222\nListenAddress 0.0.0.0\nProtocol 2\nHostKey /home/etc/ssh/ssh_host_rsa_key\nPermitRootLogin prohibit-password\nPasswordAuthentication no\nChallengeResponseAuthentication no\nUsePAM no\nAllowTcpForwarding yes\nGatewayPorts no\nX11Forwarding no\nSubsystem sftp /usr/lib/openssh/sftp-server\n" > /home/etc/ssh/sshd_config \
 && ssh-keygen -t rsa -b 4096 -f /home/etc/ssh/ssh_host_rsa_key -N ""

# Healthcheck (kept)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:80/health || exit 1

# Startup script: run sshd (2222) in background, then Node as PID 1
# (heredoc avoids fragile quoting in RUN)
RUN tee /home/startup.sh >/dev/null <<'SH'
#!/bin/sh
set -e
/usr/sbin/sshd -D -f /home/etc/ssh/sshd_config -p 2222 &
exec node index.js
SH
RUN chmod +x /home/startup.sh
CMD ["/home/startup.sh"]

