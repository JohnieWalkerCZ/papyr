FROM node:24.18.0-alpine
WORKDIR /app
RUN corepack enable
ARG NEXT_PUBLIC_TLDRAW_LICENSE_KEY=
ENV NEXT_PUBLIC_TLDRAW_LICENSE_KEY=${NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
ARG PAPYR_API_ORIGIN=http://localhost:5080
ENV PAPYR_API_ORIGIN=${PAPYR_API_ORIGIN}
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY README.md ./README.md
RUN pnpm --filter @papyr/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@papyr/web", "start"]
