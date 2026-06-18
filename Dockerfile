FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src src

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/src src
COPY --from=build /app/package.json .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/index.ts"]
