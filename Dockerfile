FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml* ./
COPY packages ./packages
COPY services ./services

RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml* ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @wireup/gateway dev"]
