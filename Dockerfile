# Image Docker de MyProxmox
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 MYPROXMOX_DATA=/app/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/bridge/dist ./bridge/dist
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
EXPOSE 8080
USER node
CMD ["node", "server/dist/index.js"]
