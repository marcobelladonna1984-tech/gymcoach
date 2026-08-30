FROM debian:bookworm-slim

# Required to fetch and verify the official Composio CLI binary
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates bash unzip \
    && rm -rf /var/lib/apt/lists/*

# Install the official Composio CLI.
# COMPOSIO_INSTALL_SHELL=none = install-only, does not touch shell startup files
# (the documented mode for Docker images / CI). The binary is SHA-256 verified.
RUN curl -fsSL https://composio.dev/install | COMPOSIO_INSTALL_SHELL=none sh

# Make the installed CLI available on PATH (persisted even in login shells)
RUN printf 'export PATH="/root/.local/bin:$PATH"\n' > /etc/profile.d/composio.sh \
    && chmod +x /etc/profile.d/composio.sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /workspace

ENTRYPOINT ["/bin/bash", "-l", "-c"]
CMD ["composio --help"]
