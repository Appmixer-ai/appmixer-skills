# Clean-box environment for testing the appmixer-skills distribution paths:
# a machine with NO appmixer-connectors checkout, NO config, NO plugin.
# Used by scripts/clean-box-test.sh (works with Colima/Docker Desktop, and
# later reusable in GitHub Actions).
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl unzip ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code

# Non-root user: mirrors a real box and lets claude run with
# --dangerously-skip-permissions (refused for root).
RUN useradd -m tester && mkdir -p /home/tester/project && chown -R tester:tester /home/tester
USER tester
WORKDIR /home/tester/project
