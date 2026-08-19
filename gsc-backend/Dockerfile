FROM node:20-alpine

# Prisma's query engine needs openssl on alpine — without this, "prisma generate"
# and the client both fail at runtime with a cryptic libssl error.
RUN apk add --no-cache openssl

WORKDIR /app

# Install deps first so this layer is cached unless package*.json changes
COPY package*.json ./
RUN npm install

# App code — overridden by the bind mount in docker-compose.yml during dev,
# but copied here too so the image is self-contained (e.g. for prod builds later).
COPY . .

# Prisma client generation happens at container start (see package.json "dev"/"start"),
# not here — DATABASE_URL only exists once docker-compose injects it at runtime, not
# during this build step, and .env is intentionally not copied into the image.

EXPOSE 3000

CMD ["npm", "run", "dev"]