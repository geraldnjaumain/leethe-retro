FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run check
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /app
RUN addgroup -S leethe && adduser -S leethe -G leethe
COPY --from=build --chown=leethe:leethe /app/package.json /app/package-lock.json ./
COPY --from=build --chown=leethe:leethe /app/node_modules ./node_modules
COPY --from=build --chown=leethe:leethe /app/dist ./dist
COPY --from=build --chown=leethe:leethe /app/scripts/serve.mjs ./scripts/serve.mjs
USER leethe
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--env-file-if-exists=.env", "scripts/serve.mjs"]
