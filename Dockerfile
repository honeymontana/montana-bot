# Build stage
FROM node:25-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json yarn.lock ./
COPY tsconfig.json ./

# Install ALL dependencies (including dev dependencies)
RUN yarn install --frozen-lockfile

# Copy source code
COPY src ./src

# Build the application
RUN yarn build

# Install only production dependencies in a clean directory
RUN mkdir -p /prod_modules && \
    cp package.json yarn.lock /prod_modules/ && \
    cd /prod_modules && \
    yarn install --production --frozen-lockfile && \
    yarn cache clean

# Production stage
FROM node:25-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package.json yarn.lock ./

# Copy production node_modules from builder (already compiled)
COPY --from=builder /prod_modules/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p logs && chown -R nodejs:nodejs logs

# Switch to non-root user
USER nodejs

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]