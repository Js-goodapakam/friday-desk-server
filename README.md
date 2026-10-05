# Friday AI Desk — Server

Friday AI Desk Server is the backend/API application for the Friday AI Desk platform. It provides the server-side application layer, database access, Prisma configuration, migrations, and API endpoints required by the client application.

## Repository

- Repository: `friday-desk-server`
- Application type: Backend / API
- Deployment: Vercel
- Database layer: Prisma

## Tech Stack

- Node.js
- JavaScript
- Prisma ORM
- Database migrations
- Vercel serverless/API deployment

## Project Structure

```text
Server/
├── api/
│   └── index.js
├── migrations/
├── src/
│   ├── prisma/
│   └── db.js
├── prisma/
├── .env.example
├── .gitignore
├── .gitattributes
├── package.json
├── package-lock.json
├── server.js
├── tsconfig.json
└── vercel.json
```

## Local Development

### 1. Clone the repository

```bash
git clone https://github.com/Js-goodapakam/friday-desk-server.git
cd friday-desk-server
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create your local environment file from the example:

```text
.env
```

Use `.env.example` as the reference for the variables required by the server.

Do not commit `.env` or any environment-specific secret file to GitHub.

### 4. Configure the database

The project uses Prisma for database access and migrations.

Before running the server, make sure the required database connection environment variables are configured.

Typical Prisma development commands include:

```bash
npx prisma generate
npx prisma migrate dev
```

Use the project's existing `package.json` scripts where available.

### 5. Start the server

Use the development/start command defined in `package.json`.

For example:

```bash
npm run dev
```

or:

```bash
npm start
```

## API

The server exposes the backend/API layer consumed by the Friday AI Desk Client.

The Vercel API entry point is:

```text
api/index.js
```

The application server entry point is:

```text
server.js
```

## Database

Prisma is used as the ORM/database access layer.

Important Prisma operations:

```bash
npx prisma generate
npx prisma migrate dev
```

For production database changes, use the project's approved migration/deployment process rather than modifying production data manually.

## Deployment

The Server is deployed on Vercel.

Recommended deployment flow:

```text
Developer
   │
   ▼
GitHub — friday-desk-server
   │
   ▼
Vercel
   │
   ▼
Friday AI Desk API
   │
   ▼
Database
```

Environment variables required by the backend should be configured in the Vercel project rather than committed to GitHub.

## Git Workflow

Recommended branches:

```text
main
develop
feature/*
```

Use `main` for production-ready code.

Example:

```bash
git checkout -b feature/new-api
git add .
git commit -m "Add new API functionality"
git push -u origin feature/new-api
```

## Related Frontend

The frontend is maintained separately:

**Friday AI Desk Client**

`https://github.com/Js-goodapakam/friday-desk-client`

## Security

Never commit:

- `.env`
- Database credentials
- API keys
- Passwords
- Access tokens
- Private keys
- Production secrets
- Customer/private data

The repository is configured to exclude environment files and Vercel/local development metadata.

The repository contains `.env.example` as a safe template/reference.

## Production Notes

Before deploying changes:

1. Verify environment variables.
2. Verify database connectivity.
3. Run the required Prisma generation/migration steps.
4. Test the API locally.
5. Review the Git diff.
6. Commit and push the required changes.
7. Verify the Vercel deployment and API health.

## Status

Friday AI Desk Server is maintained as the backend/API repository for the Friday AI Desk platform.
