# Vercel deployment

Team: `clgrizvan-8911s-projects`

- Frontend project: `nattukoottam`, https://nattukoottam-two.vercel.app
- Backend project: `nattukoottam-api`, https://nattukoottam-api.vercel.app

## Frontend

Deploy the repository root using its `vercel.json` configuration:

```sh
npx vercel deploy --prod --yes --project nattukoottam --scope clgrizvan-8911s-projects
```

Vercel project environment variables include `API_URL` (the backend URL with
`/api` appended), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`.

## Backend

Build with Nx, then prepare the standalone function artifact:

```sh
npm exec nx run api:build
node scripts/prepare-vercel-api.cjs
npx vercel deploy --prod --yes --project nattukoottam-api --scope clgrizvan-8911s-projects --cwd tmp/vercel-api
```

The adapter imports NestJS 12's ESM dependencies before loading the Nx bundle,
initializes NestJS once per function instance, and forwards requests to its
Express handler. Dependencies are installed on Vercel and Prisma Client
is generated there. The artifact uses Node 22, matching the local runtime.
Required backend credentials are configured as encrypted Vercel environment
variables; local environment files are excluded from frontend source uploads.

Check `/api/health` and `/api/docs` on the backend and `/api/health` through the
frontend proxy after deploying. These are CLI deployments; pushing to GitHub
does not automatically deploy these projects.

The existing in-process escalation interval and persistent realtime connection
follow function instance lifetimes. A reliable recurring escalation schedule
requires a separate scheduled job; function timers do not provide that guarantee.
