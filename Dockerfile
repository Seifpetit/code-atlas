FROM node:22-slim AS build

WORKDIR /app

COPY backend/package*.json backend/
RUN npm --prefix backend ci

COPY frontend/package*.json frontend/
RUN npm --prefix frontend ci

COPY backend backend
COPY frontend frontend

RUN npm --prefix frontend run build
RUN npm --prefix backend run build

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json backend/
RUN npm --prefix backend ci --omit=dev

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

EXPOSE 4000

CMD ["npm", "--prefix", "backend", "start"]
