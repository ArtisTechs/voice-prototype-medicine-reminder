# Deploy on Render

The repo has a Blueprint ([render.yaml](../render.yaml)): one Docker web service (`voice-api`, API plus cron jobs) and one Key Value (Redis) instance.

## Steps
1. **MySQL.** Render has no managed MySQL. Create a free MySQL 8 at [Aiven](https://aiven.io) or [TiDB Cloud](https://tidbcloud.com), with an empty database `medrem`. Copy its connection URL.
2. **Gemini key.** Create one at https://aistudio.google.com/apikey.
3. Push this repo to GitHub. In Render: **New > Blueprint**, pick the repo.
4. When Render asks for the secret values, enter `DATABASE_URL` and `GEMINI_API_KEY`. [render.env.example](../render.env.example) lists every variable and what it is for. You can change them later under *voice-api > Environment*.
5. Deploy. The entrypoint runs `prisma migrate deploy` before the server starts. Check `https://<service>.onrender.com/healthz` for `{"status":"ok","db":true,"redis":true}`.
6. **App:** set `EXPO_PUBLIC_API_URL=https://<service>.onrender.com`.
7. **Pillbox:** read `DEVICE_PATH_SECRET` under *Environment* and set the firmware's `BACKEND_URL` to `https://<service>.onrender.com/d/<DEVICE_PATH_SECRET>` (see [deploy-gcp.md](deploy-gcp.md) for the device-path idea).

## Things to know
- **Plan:** use `starter` or higher. A free web service sleeps after 15 minutes, so the missed-dose and offline jobs and the pillbox would not work.
- **Jobs:** `EMBED_WORKER=true` runs them inside the API process. Do not scale `voice-api` to more than one instance with it on without the optional separate worker (the jobs use Redis locks, so extra copies are safe but wasteful).
- **HTTPS only:** Render redirects HTTP to HTTPS. Check that the firmware's HTTP client can do TLS to `onrender.com`; if it cannot, host on a VM with plain HTTP instead ([deploy-gcp.md](deploy-gcp.md)).
- **Scan photos:** the filesystem is wiped on every deploy unless you uncomment the `disk` block (paid plans). Scan results stay in MySQL either way.
- **Seed:** `SEED_DEMO` is `false`. Sign up in the app to create your account.
- **Privacy:** Gemini free tier inputs may be used by Google to improve its products (notice in the app's Settings).
