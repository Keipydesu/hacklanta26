# Fonts use the existing checksum verifier; Python is not needed in the Expo runtime.
FROM python:3.13-slim AS fonts
WORKDIR /mobile
COPY mobile/scripts/fetch-fonts.py scripts/fetch-fonts.py
COPY mobile/assets/fonts assets/fonts
RUN python3 scripts/fetch-fonts.py

# Official Node 24.21.0 bookworm-slim; review and provenance in DEV-RUNTIME-REVIEW.md.
FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node mobile/package.json mobile/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY --chown=node:node mobile/ ./
COPY --from=fonts --chown=node:node /mobile/assets/fonts/ ./assets/fonts/
RUN npm run map:bundle
EXPOSE 8081
# Prestart's font/map preparation is already done in the image, from the same locked inputs.
CMD ["node", "node_modules/expo/bin/cli", "start", "--go", "--lan", "--port", "8081"]
