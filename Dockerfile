FROM node:24-bookworm-slim AS development
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM development AS build
RUN npm run build

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/schema.sql ./src/db/schema.sql
COPY --from=build /app/src/views ./src/views
COPY --from=build /app/src/public ./src/public
USER node
EXPOSE 3000
CMD ["npm", "start"]
