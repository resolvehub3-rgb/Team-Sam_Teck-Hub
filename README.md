# Sam_Teck Hub

A production-grade, unified SaaS platform for project and task management, team collaboration, virtual meetings on Google Meet (**Sam_Teck Meet**), technology innovation, professional development, and operational reporting.

---

## 1. Product Overview

**Sam_Teck Hub** provides a secure workspace where founders, leadership teams, project managers, technical teams, researchers, learners, and authorized collaborators collaborate to turn ideas into completed projects and sustainable businesses.

### Key Capabilities

- **Real Data Only**: Zero simulated mock data, zero fake users, and zero hardcoded dashboard numbers. All statistics are queried dynamically from real PostgreSQL records.
- **First-Time Administrator Setup**: Server-guarded initialization flow that provisions the initial Super Administrator and primary workspace. Once complete, setup locks automatically.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions across 7 roles: Super Administrator, Team Leader / Founder, Assistant Team Leader, Project Manager, Department Lead, Team Member, and External Guest.
- **Sam_Teck Meet**: Schedule or launch real **Google Meet** sessions (spaces created server-side via the Google Meet REST API), with the join link opening in a new tab, plus meeting minutes, decisions and action items tracked in-app with their project-task status.
- **Project & Task Management**: Interactive Kanban board (`Backlog`, `To Do`, `In Progress`, `In Review`, `Blocked`, `Done`), milestones, priorities, deadlines, and task assignment.
- **Innovation Lab**: Idea proposal pipeline, structured leadership reviews, and direct conversion of approved proposals into project roadmaps.
- **Learning & Professional Development**: Knowledge base, course modules, assignments, and skill mastery tracking.
- **Business Operations & Finance**: Client service proposals, project budgets, and approved expense ledgers.
- **Reports & Accountability**: Dynamic completion rates, overdue tracking, and CSV data export.
- **Administration & Audit Governance**: Integration health monitoring, system settings, and an immutable audit log.

---

## 2. Technology Stack

- **Frontend**:
  - React 19 + TypeScript
  - Vite build tool
  - Tailwind CSS v4 with custom brand tokens
  - **Montserrat** font family for all typography
  - Lucide React icon library
- **Backend**:
  - Node.js + Express (`server.ts`) running on port 3000
  - Vite middlewares mounted in development (`tsx server.ts`)
  - Server-side Google Meet REST client (OAuth refresh-token exchange with in-memory access-token cache)
  - First-time setup provisioning and action-item conversion endpoints
- **Database & Storage**:
  - Supabase PostgreSQL with 39 version-controlled relational entities
  - Supabase Row-Level Security (RLS) policies on every table
  - Supabase Auth (email/password, invitation activation)
  - Supabase Storage for project deliverables and meeting documents
  - Supabase Realtime for instant synchronization
- **Virtual Meetings**:
  - Google Meet via the official Meet REST API (server-side space creation)
  - Join hands off to `https://meet.google.com/` in a new tab — see §8 for why in-app embedding is not possible
  - Least-privilege scope: `https://www.googleapis.com/auth/meetings.space.created`
  - `src/lib/googleMeetCore.ts` (pure state model) + `src/lib/googleMeet.ts` (network layer)

---

## 3. Brand Identity & Typography

- **Primary Deep Blue**: `#123B73`
- **Dark Navy**: `#0B1F3A`
- **Secondary Blue**: `#2457A7`
- **Light Background**: `#F5F8FC`
- **Primary Text**: `#172B4D`
- **Muted Text**: `#65758B`
- **Border**: `#DCE5F0`
- **Font Family**: **Montserrat** (300, 400, 500, 600, 700, 800, 900) across all UI elements, forms, and headers.

---

## 4. Environment Configuration

Create a `.env` file in the root directory (based on `.env.example`):

```env
# ====================================================================
# SUPABASE CONFIGURATION (MANDATORY)
# ====================================================================
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-public-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# ====================================================================
# GOOGLE MEET CONFIGURATION (FOR SAM_TECK MEET) - SERVER-SIDE ONLY
# ====================================================================
# An API key does NOT work here. The Meet REST API replies to every API-key
# request with 401 "API keys are not supported by this API. Expected OAuth2
# access token..." You need OAuth 2.0 user credentials from a Google Cloud
# project with the Google Meet API enabled and the `meetings.space.created`
# scope. Full setup steps are in .env.example.
#
# Never prefix these with VITE_ / NEXT_PUBLIC_: Vite inlines such values into
# the public browser bundle, publishing your credentials to every visitor.
GOOGLE_MEET_CLIENT_ID=""
GOOGLE_MEET_CLIENT_SECRET=""
GOOGLE_MEET_REFRESH_TOKEN=""

# ====================================================================
# FIRST-TIME SETUP PROVISIONING SECRET (OPTIONAL)
# ====================================================================
SETUP_PROVISIONING_SECRET="your-secure-setup-token"

# ====================================================================
# SERVER & GENERAL SETTINGS
# ====================================================================
PORT=3000
APP_URL="http://localhost:3000"
```

> **Note**: If Supabase environment variables have not yet been provided, the application starts with a clean database configuration banner allowing runtime credential entry or manual execution of the PostgreSQL migration script.

---

## 5. Database Setup & Migrations

The schema migration scripts are located at, **in order**:

```
supabase/migrations/20261016000000_sam_teck_hub_schema.sql
supabase/migrations/20261019000000_google_meet_integration.sql
```

> **Both must be applied.** The second one adds the Google Meet columns
> (`google_space_name`, `google_meeting_uri`, `google_sync_status`,
> `google_last_error`, `google_synced_at`) and renames `livekit_room_name` to
> `room_name`. Applying only the first leaves the app sending a column the
> database does not have, which surfaces as:
> `Could not find the 'livekit_room_name' column of 'meetings' in the schema cache`.

### Applying the Schema:

1. Open your Supabase project dashboard.
2. Navigate to the **SQL Editor**.
3. Copy and paste the contents of `supabase/migrations/20261016000000_sam_teck_hub_schema.sql`.
4. Click **Run**.
5. Repeat for `supabase/migrations/20261019000000_google_meet_integration.sql`.
5. All 39 tables, enums, triggers, foreign keys, and Row Level Security (RLS) policies will be provisioned.

---

## 6. Installation & Running Locally

### Prerequisites

- Node.js v20+ or v22+
- npm v10+

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Run Fast-Feedback Unit Tests

Verify core pure business logic (budget math, task progress, role checks, setup validation):

```bash
node --test src/utils/rules.test.ts
```

### Step 3: Start the Development Server

Runs the fullstack Express backend and Vite middleware on `http://localhost:3000`:

```bash
npm run dev
```

### Step 4: Build for Production

```bash
npm run build
```

To start the production server:

```bash
npm start
```

---

## 7. First-Time Administrator Setup Flow

1. On initial launch, if no Super Administrator has been provisioned, navigating to the application renders the **First-Time Administrator Setup** screen.
2. Enter:
   - **Administrator Full Name** (e.g., Samuel Teckman)
   - **Administrator Email** (e.g., admin@samteck.org)
   - **Secure Password** (minimum 8 characters)
   - **Primary Workspace Name** (e.g., Sam_Teck Innovations)
   - **Setup Secret** (matches `SETUP_PROVISIONING_SECRET` if set in `.env`)
3. Click **Initialize Super Administrator**.
4. The server creates the administrative account, sets up the organization and the default "Executive Leadership" department, records the action in `audit_logs`, and marks initialization complete in `system_settings`.
5. The setup route is permanently closed to prevent duplicate provisioning.

---

## 8. Sam_Teck Meet: Virtual Meeting Workflow

1. **Schedule or Instant Meeting**: Authorized members schedule a meeting linked to a project/department, or open one directly at `/meet/:slug`.
2. **Google Meet provisioning**: On creation, the server calls the Google Meet REST API to create a space. Only meeting hosts/leadership can do this (`MEETING_LEAD_ROLES`), and only once — the result is stored on the `meetings` row in `google_meeting_uri`, so repeated requests never create a second space.
3. **Join**: The **Join** button opens the stored `https://meet.google.com/...` link in a new tab. Sam_Teck Hub performs no in-app video, has no pre-join device check, and never requests camera or microphone access.
4. **Meeting details**: Decisions, minutes and action items stay in Sam_Teck Hub in the meeting details panel, independent of Google Meet.
   - Each action item shows whether it has been promoted to a project task (`Added to project tasks` / `Not yet a task`).
5. **Ending**: an explicit host-end makes a best-effort `endActiveConference` call so the space is closed.

### Why Google Meet opens in a new tab

This is a deliberate constraint from Google, not a shortcut. Both were verified
against current official documentation before implementation:

1. **The Meet Embed SDK no longer exists.** Google retired the Web embed SDK —
   the legacy embed URLs and `embed.js` now return 404. There is no supported
   way to render the Meet interface inside another page.
2. **Cross-origin embedding is blocked anyway.** `meet.google.com` sends
   `X-Frame-Options: SAMEORIGIN`, so even a hand-rolled iframe of a Meet URL is
   rejected by the browser before any of our code runs.

Additionally, the Meet REST API creates and manages **spaces** — it does not
stream video. It returns a join URI; the conference itself is always rendered
by Google.

So the honest implementation stores the real link and hands it to the browser.
Faking an in-page stage, drawing decorative mic/camera controls, or silently
opening a blank page would misrepresent where the video actually happens — none
of which is done here.

---

## 9. Security & Access Control

- **Row Level Security (RLS)**: Enforced on all Supabase tables. Organization members can only read and write records belonging to workspaces where they hold active memberships.
- **Server-Side Only Credentials**: The Google OAuth client id, secret and refresh token live only in server-side environment variables (never prefixed `VITE_`, so Vite cannot inline them into the public bundle). The browser is only ever handed the finished `https://meet.google.com/` link. Access tokens are minted server-side, cached in memory for their lifetime, and never leave the API.
- **Least-Privilege Scope**: the only Google scope requested is `https://www.googleapis.com/auth/meetings.space.created`, which can create spaces but cannot read a user's Drive, mail or calendar.
- **Immutable Audit Logging**: Administrative events, role updates, and setup provisioning are logged with timestamps, actor IDs, and IP metadata.

---

## 10. Deploying to Vercel

The app splits into two pieces on Vercel: the Vite build is served as static
files by the CDN, and `server.ts` runs as a single serverless function mounted
by `api/index.ts`. All `/api/*` traffic is rewritten to that function
(`vercel.json`); every other path falls through to `index.html` for
client-side routing.

### How the split works

- `server.ts` exports the Express `app` and skips `app.listen()` whenever
  `process.env.VERCEL` is set, so importing it into a function does not try to
  bind a port.
- The `vite` import is lazy (dynamic) and only runs in local development, so
  the bundler is not pulled into the serverless bundle.
- Document uploads are capped at **4 MB** rather than 10 MB, because Vercel
  rejects request bodies over 4.5 MB at the platform edge. Raising this means
  moving uploads to signed direct-to-storage uploads.

### One-time setup

```bash
npm install -g vercel   # if not already installed
vercel login
vercel link             # attach this folder to a Vercel project
```

### Required environment variables

Set these in the Vercel project under **Settings → Environment Variables**
(Production). They are needed at **build time** as well as runtime, because
`VITE_*` values are inlined into the browser bundle during `vite build`:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL (baked into the client bundle) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (baked into the client bundle) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never exposed to the browser |
| `APP_URL` | Public URL of this deployment. Builds invitation links |
| `GOOGLE_MEET_CLIENT_ID` | Optional. Google OAuth client id (server-only) |
| `GOOGLE_MEET_CLIENT_SECRET` | Optional. Google OAuth client secret (server-only) |
| `GOOGLE_MEET_REFRESH_TOKEN` | Optional. Grant used to mint access tokens (server-only) |
| `SETUP_PROVISIONING_SECRET` | Optional first-run provisioning token |

> The three `GOOGLE_MEET_*` values are optional: leave them unset and the rest
> of the app works unchanged, with meeting joins reporting that Google Meet is
> not connected to this deployment. They are deliberately **not** `VITE_*` —
> such values would be inlined into the public bundle.

> `APP_URL` must be the real public URL (e.g. `https://your-app.vercel.app`),
> not `localhost`. Invitation links are constructed from it, so a wrong value
> sends members to a link that does not resolve.

### Supabase redirect allow-list (required for invitations)

Supabase Auth validates the invitation `redirectTo` host against an allow-list,
so the Vercel domain must be registered or invitation emails will bounce:

1. Open the Supabase dashboard → **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL.
3. Add `https://your-app.vercel.app/**` to **Redirect URLs**.

### Deploy

```bash
vercel --prod
```

### Known platform limits

- **4.5 MB request body cap** — document uploads are limited to 4 MB to stay
  under it.
- **60 s function timeout** — configured in `vercel.json`. First-run
  administrator provisioning pages through the user directory and may approach
  this on very large organizations.
- **No persistent in-memory state** — `hasProvisionedInitialAdmin` is
  per-instance and resets between invocations; the setup flow already falls
  back to the `system_settings` row in the database, so behaviour is unchanged.

---

## 11. License

Licensed under the Apache License, Version 2.0.
