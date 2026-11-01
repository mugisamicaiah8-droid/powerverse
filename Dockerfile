# PowerVerse signaling server — minimal production image.
# The app itself is static and does not go in this image; only the signaling process.

FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

WORKDIR /app

# Copy manifests first so `npm ci` layer is cached across source changes.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY server.js ./

# Run unprivileged.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
