# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time,
# so this must be the URL the *browser* uses to reach the API.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_ENABLE_DEV_TOOLS=false
ENV NEXT_PUBLIC_ENABLE_DEV_TOOLS=$NEXT_PUBLIC_ENABLE_DEV_TOOLS
ARG NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE=0.8
ENV NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE=$NEXT_PUBLIC_GESTURE_MIN_CONFIDENCE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prebuild copies the MediaPipe WASM runtime from node_modules into public/;
# the gesture model ships in public/models. Both end up in the image below.
RUN npm run build && test -f public/mediapipe/wasm/vision_wasm_internal.wasm \
  && test -f public/models/gesture_recognizer.task

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
