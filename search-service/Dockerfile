FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

# Run as the unprivileged user that ships with the official Node image.
USER node

EXPOSE 3007

# Run node directly so it receives SIGTERM from "docker stop".
CMD ["node", "server.js"]
