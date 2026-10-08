# Price Bot — source export

This archive includes the web app, mobile app, API server, component previews, shared libraries, dependency lockfile and current Baileys patch. It contains the current working-tree files, including changes not yet published.

Excluded intentionally: secrets/.env files, WhatsApp authentication and QR codes, database contents and backups, uploaded user data, dependency folders, generated builds, Git history, and agent conversation/memory files. Database schema source is included; live data is not.

## Setup
1. Extract the archive. Install Node.js and pnpm.
2. Run: pnpm install --frozen-lockfile
3. Configure DATABASE_URL, SESSION_SECRET and GOOGLE_MAPS_API_KEY in your environment. These values are NOT included.
4. Set up a PostgreSQL database using the schema in lib/db. Review schema changes before applying them; do not force destructive changes against an existing database.
5. For the API: PORT=8080 pnpm --filter @workspace/api-server run dev
6. For the web app: pnpm --filter @workspace/price-bot run dev
7. For mobile: pnpm --filter @workspace/price-bot-mobile run dev

Artifact routing and managed startup configuration are preserved under each artifact's .replit-artifact directory. Outside Replit, configure the corresponding ports, base paths and API routing for your hosting setup. The exported source is not a self-contained running installation.

WhatsApp authentication must be established separately. Do not connect the same linked-device authentication from development and production concurrently.
