# Nova Support

AI-powered customer support app for Shopify.

## Prerequisites

- Node.js 20 (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 9.0.0

```bash
nvm use
corepack enable
corepack prepare pnpm@9.0.0 --activate
```

## Setup

```bash
pnpm install
```

Copy environment files for each app:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
cp apps/api/.env.example apps/api/.env
```

## Development

Start all apps in development mode (dashboard on port 3000, API on port 3001):

```bash
pnpm dev
```

- Dashboard: http://localhost:3000
- API health: http://localhost:3001/health

## Build

```bash
pnpm build
```

## Other scripts

| Command          | Description               |
| ---------------- | ------------------------- |
| `pnpm lint`      | Lint all packages         |
| `pnpm typecheck` | Type-check all packages   |
| `pnpm test`      | Run tests                 |
| `pnpm format`    | Format code with Prettier |

## Monorepo structure

```
apps/
  dashboard/   # Next.js 14 app (embedded in Shopify Admin)
  api/         # Node.js + Fastify API server
packages/
  shared/      # Shared TypeScript types, constants, utilities
  ui/          # Shared React component library (shadcn/ui base)
```

## Git hooks

Husky runs `lint-staged` on pre-commit (ESLint + Prettier).
