
FROM node:24-bookworm-slim

WORKDIR /app

# Install deps first
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Runtime tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl openssh-server \
    && rm -rf /var/lib/apt/lists/*

# Put sshd_config in image, not in /home
RUN printf "Port 2222\nListenAddress 0.0.0.0\nProtocol 2\nHostKey /home/etc/ssh/ssh_host_rsa_key\nPermitRootLogin prohibit-password\nPasswordAuthentication no\nChallengeResponseAuthentication no\nUsePAM no\nAllowTcpForwarding yes\nGatewayPorts no\nX11Forwarding no\nSubsystem sftp /usr/lib/openssh/sftp-server\n" > /etc/ssh/sshd_config

# App Service injects PORT; use 8080 default
ENV NODE_ENV=production
ENV PORT=8080

# Document ports
EXPOSE 8080 2222

# Healthcheck (your app serves GET /health already)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

# Startup script under image path (not /home)
RUN printf "#!/bin/sh\nset -e\n# Ensure runtime and key dirs\nmkdir -p /run/sshd\nchmod 0755 /run/sshd\nmkdir -p /home/etc/ssh\n# Generate host key into /home (persisted)\nif [ ! -f /home/etc/ssh/ssh_host_rsa_key ]; then ssh-keygen -t rsa -b 4096 -f /home/etc/ssh/ssh_host_rsa_key -N \"\"; fi\n# Start sshd in background using image config\n/usr/sbin/sshd -D -f /etc/ssh/sshd_config -p 2222 &\n# Start Node app bound to process.env.PORT\nexec node index.js\n" > /usr/local/bin/startup.sh && chmod +x /usr/local/bin/startup.sh

ENTRYPOINT ["/usr/local/bin/startup.sh"]
