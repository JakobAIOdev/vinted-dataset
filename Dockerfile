FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY README.md ./README.md

ENV NODE_ENV=production
ENV PORT=4010
ENV DATASET_OUTPUT_DIR=/app/output

EXPOSE 4010

CMD ["node", "src/cli.js", "serve"]
