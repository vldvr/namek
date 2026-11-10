FROM node:24-alpine
WORKDIR /app
COPY bot.mjs ./
USER node
ENV NODE_NO_WARNINGS=1
CMD ["node", "bot.mjs"]
