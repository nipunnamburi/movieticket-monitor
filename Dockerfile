FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Generate Prisma Client
RUN npm run db:generate

# Build all packages and the React web application
RUN npm run build

# Default environment
ENV NODE_ENV=production
ENV PORT=5055

EXPOSE 5055

# Run API (serving React UI + API) and Worker concurrently
CMD ["npm", "run", "start"]
