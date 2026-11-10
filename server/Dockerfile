# Контекст сборки — корень репозитория: серверу нужны правила (src/engine) и протокол (src/protocol).
FROM node:24-alpine
WORKDIR /app
# Зависимости в корне /app: их импортируют и server/, и src/protocol.
COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src/engine ./src/engine
COPY src/protocol ./src/protocol
COPY server/main.ts server/room.ts server/words.ts server/seed-words.txt ./server/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=8080 DB_FILE=/app/data/namek.db ROOMS_FILE=/app/data/rooms.json SEED_FILE=/app/server/seed-words.txt NODE_NO_WARNINGS=1
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["node", "--experimental-strip-types", "server/main.ts"]
