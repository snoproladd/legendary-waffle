
FROM node:24-trixie-slim

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# ---------- SSH enablement for App Service custom containers ----------
# 1) Install curl (for healthcheck) and openssh-server (for SSH)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl openssh-server \
    && rm -rf /var/lib/apt/lists/*

# 2) Create directories for sshd (App Service expects config & keys under /home)
RUN mkdir -p /home/etc/ssh

# 3) Provide a strict sshd_config (port 2222, no password auth)
#    NOTE: On Debian, sftp-server lives in /usr/lib/openssh/
RUN printf "Port 2222\nListenAddress 0.0.0.0\nProtocol 2\nHostKey /home/etc/ssh/ssh_host_rsa_key\nPermitRootLogin prohibit-password\nPasswordAuthentication no\nChallengeResponseAuthentication no\nUsePAM no\nAllowTcpForwarding yes\nGatewayPorts no\nX11Forwarding no\nSubsystem sftp /usr/lib/openssh/sftp-server\n" > /home/etc/ssh/sshd_config

# 4) Generate host keys (kept in /home to survive App Service restarts)
RUN ssh-keygen -t rsa -b 4096 -f /home/etc/ssh/ssh_host_rsa_key -N ""

# Runtime env
ENV NODE_ENV=production
ENV PORT=80

# Document ports
EXPOSE 80 2222

# Healthcheck (unchanged; uses ${PORT})
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

# Startup script: launch sshd then the Node app
RUN printf "#!/bin/sh\nset -e\n/usr/sbin/sshd -D -f /home/etc/ssh/sshd_config -p 2222 &\nexec node index.js\n" > /home/startup.sh \
    && chmod +x /home/startup.sh

# Run the shell script directly (do not pass it to `node`)
ENTRYPOINT ["/home/startup.sh"]
``
