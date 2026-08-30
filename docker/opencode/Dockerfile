FROM node:22-bookworm-slim

# deps for composio installer (curl, unzip) and general tooling
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates unzip git bash \
    && rm -rf /var/lib/apt/lists/*

# Install the opencode CLI globally (runs on Node)
RUN npm install -g opencode-ai@latest

# Install the official Composio CLI (install-only, Docker/CI mode, SHA-256 verified)
RUN curl -fsSL https://composio.dev/install | COMPOSIO_INSTALL_SHELL=none sh
RUN printf 'export PATH="/root/.local/bin:$PATH"\n' > /etc/profile.d/composio.sh && chmod +x /etc/profile.d/composio.sh
ENV PATH="/root/.local/bin:${PATH}"
ENV NODE_ENV=production

WORKDIR /workspace

ENTRYPOINT ["/bin/bash", "-l", "-c"]
CMD ["opencode"]
