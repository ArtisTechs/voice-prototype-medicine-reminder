# Use Supabase as the database

The backend (API, worker, scan recognition) still runs in Docker on the laptop; only the database moves to Supabase's free hosted Postgres. Every laptop that uses the same `DATABASE_URL` sees the same people, medicines and history.

## 1. Create the project
1. Sign up at [supabase.com](https://supabase.com) and click **New project**.
2. **Name:** `voice`. **Database password:** click *Generate*, or type a long one using **only letters and numbers** (symbols such as `@ : / ? #` break the connection URL). Save it in a password manager.
3. **Region:** *Southeast Asia (Singapore)*, the closest to the Philippines. **Plan:** Free.
4. Wait about 2 minutes until the project is ready. Do not create tables by hand: the backend creates them.

## 2. Copy the connection string
1. Click **Connect** at the top of the project page.
2. Choose **Session pooler** (not *Direct connection*, which needs IPv6, and not *Transaction pooler*).
3. Copy the URI. It looks like:
   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
4. Change it for the backend:
   - `postgresql://` → `postgresql+asyncpg://`
   - `[YOUR-PASSWORD]` → your password (no brackets)
   - add `?ssl=require` at the end

## 3. Put it in `.env`
```
DATABASE_URL=postgresql+asyncpg://postgres.abcdefghijkl:YourPassword123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?ssl=require
DB_POOL_SIZE=3
DB_MAX_OVERFLOW=2
```
The small pool keeps the API and worker inside the free plan's connection limit.

## 4. Start
Run `start-voice.cmd` (or `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --force-recreate api worker`). On startup the API creates the tables in Supabase, turns on row-level security, and (with `SEED_DEMO=true`) adds the demo account. Check:
- `docker compose logs api` shows no connection errors.
- Supabase → **Table Editor** lists `users`, `patients`, `medicines`, … (each marked RLS enabled).
- The app signs in with **demo@example.com / demo1234**.

## 5. Other laptops
Copy these lines from the first laptop's `.env` into the other laptop's `.env` (send them privately; they contain the database password):
```
DATABASE_URL=...
DB_POOL_SIZE=3
DB_MAX_OVERFLOW=2
JWT_SECRET=...      # same secret, so sign-ins stay valid on both laptops
```
Only run **one** laptop's backend at a time: two workers would both send the same alerts.

## Good to know
- **Security:** Supabase also exposes tables through its own web API. Row-level security (migration `b7c2e5a91f03`) blocks that API completely; the backend is the table owner and is unaffected. For extra safety you can turn the Data API off under **Project Settings → Data API**.
- **Pausing:** free projects pause after about a week with no activity. If that happens, open the Supabase dashboard and click **Restore**.
- **Size:** the free plan holds 500 MB, far more than VOICE needs. Scan photos are not stored in the database.
- **Photos stay on the laptop:** package reference photos and scan images are saved in the laptop's Docker volume. On another laptop, recognition still works (it uses the stored fingerprints in the database), but those images will not display.
- **Tests** always use the local Docker database, never Supabase.
- **Go back to local:** delete or comment out `DATABASE_URL` in `.env` and restart.
