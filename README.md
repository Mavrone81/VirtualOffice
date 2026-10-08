This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Prerequisites

Beyond `pnpm install`, the test suite shells out to real binaries and talks to a
real database. Missing any of these does not skip the affected tests — they fail,
and the failure looks like a regression rather than a missing tool.

| Needed for | Install |
|---|---|
| Everything — the project targets **Node 22** (the default `node` on some machines is newer and breaks jsdom/esbuild) | `nvm use 22` |
| The PDF tests, which rasterise generated PDFs and compare ink coverage | `brew install ghostscript poppler` |
| The two `integration` test projects | any PostgreSQL 16 the `DATABASE_URL` can reach |

CI installs `poppler-utils` and `ghostscript` for the same reason and fails
loudly if they are not on `PATH` afterwards, rather than letting the PDF tests
die with ENOENT (see `.github/workflows/ci-cd.yml`).

A throwaway database for the integration projects:

```bash
docker run -d --rm --name vo-itest \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=votest \
  -p 55433:5432 postgres:16-alpine

export DATABASE_URL="postgresql://test:test@127.0.0.1:55433/votest"
npx prisma migrate deploy        # NOT `db push` — see below
npx vitest run --project integration --project integration-unsuffixed
```

> **Use `prisma migrate deploy`, never `prisma db push`, to prepare a test
> database.** `db push` derives the schema from `schema.prisma` and therefore
> skips every statement that exists only inside a migration — raw SQL, CHECK
> constraints, sequences. The database it builds looks correct and silently
> cannot reproduce whole classes of failure, so the tests pass locally and fail
> in CI.


## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
