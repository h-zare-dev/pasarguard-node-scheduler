FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src/ ./src/

USER node
HEALTHCHECK --interval=60s --timeout=5s --start-period=90s \
  CMD node -e "const fs=require('node:fs');const s=fs.statSync('/data/heartbeat');process.exit(Date.now()-s.mtimeMs<180000?0:1)"

CMD ["node", "src/main.js"]
