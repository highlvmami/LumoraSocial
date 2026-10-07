<div align="center">

# LumoraSocial

**A Turkish-language social network with posts, stories, messaging, #hashtags and automatic content moderation.**

**[Live demo →](https://lumorasocial.onrender.com)** · **[Android app](https://lumorasocial.onrender.com/indir)**

[Türkçe](README.md) · English

<p>
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white" alt="Express 5">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Turso-4FF8D2?logo=turso&logoColor=black" alt="Turso">
  <img src="https://img.shields.io/badge/Web%20Push-5A0FC8?logo=pwa&logoColor=white" alt="Web Push">
  <img src="https://img.shields.io/badge/Android-TWA-3DDC84?logo=android&logoColor=white" alt="Android">
  <img src="https://img.shields.io/badge/Render-46E3B7?logo=render&logoColor=black" alt="Render">
</p>

</div>

A social network for friends and communities. Members share text, photos and polls, post stories, follow each other and chat; profanity and explicit photos are blocked automatically before they are published. The server is Node.js + Express, the database is SQLite locally and Turso in production, and the interface is a framework-free single-page app in plain HTML/CSS/JS. There is also an Android app.

> The demo runs on Render's free plan. After about 15 minutes without visitors it goes to sleep, and the first visit then takes up to a minute to wake it.

The interface is in Turkish.

## Features

### Posts and feed
- Text posts with up to 4 photos (resized in the browser, full screen on click) and polls (2–4 options, with a deadline).
- 6 emoji reactions, comments and **reposts** (quote with an optional comment).
- **Feed:** posts from people you follow and your own; the admin's posts appear in everyone's feed so new members never see an empty page.
- **Explore:** all posts, or the most popular posts of the last 7 days.
- **#hashtags:** clicking a tag opens its page with the total post count and every tagged post. **Popular topics** lists the most used tags of the last 30 days with their counts.
- **@mentions:** username suggestions while typing, and a notification for the mentioned person.
- **Stories:** visible for 24 hours, text or photo; viewer list, emoji reactions and replies (sent as messages), archive and highlights.
- **Bookmarks:** save a post from its ⋯ menu and find it on a separate page.

### Interaction
- **Following:** public or private accounts (with follow requests), suggested people.
- **Messaging:** one-to-one chat, photos, typing indicator, read receipts, unread counter.
- **Notifications:** reactions, comments, reposts, mentions, follows, achievements, sign-ins from new devices; push notifications on the phone (Web Push) and an unread badge on the app icon.
- **Achievements:** 21 achievements for posts, messages, following, followers, comments, reactions received, stories, polls, hashtags and membership age. Earning one sends a notification; badges show on the profile and progress bars on the Achievements page.
- **Feedback and suggestions:** members send a suggestion, bug report or other note, follow its status (New / Read / Done) and get notified when it is done.

### Profile and account
- Profile and cover photo, display name, bio, birthday, location, website, social links, job, education, interests, verified badge (✓), admin and moderator badges.
- Sign up with email, phone or just a username. Email verification, password reset, Google / GitHub sign-in (a provider's button appears once its keys are set).
- **Privacy:** private accounts; "Everyone / Followers / Only me" for birthday, location and contact details; blocking.
- **Security:** active sessions and devices, sign out of one or all of them, notification and email alert for new-device and suspicious sign-ins.
- Light and dark theme.

### Safe community
- **Automatic text moderation:** Turkish and English profanity, slurs and sexual terms are rejected in posts, comments, polls, stories, messages, usernames, display names and profile fields. It also catches evasions like `s.i.k`, `4mk`, `f*ck` and `siiiktir`, while leaving innocent words such as `sıkıldım` ("I'm bored") or `I got it` alone. It is free and runs on the server (`src/services/moderation.js`).
- **Automatic photo moderation:** post, story, message, profile and cover photos are checked for nudity and sexual content with [Sightengine](https://sightengine.com) (free up to 2,000 photos a month). Without keys the check is skipped; if the service fails, the site keeps working.
- **Reports:** posts, comments and users can be reported; the admin panel can delete content, suspend users, or resolve / dismiss reports.

### Admin panel (`/yonetim`)
- Statistics, user search, roles (admin / moderator / member), verified badge, suspension, password reset, user deletion, creating new accounts.
- **Reports**, **Feedback** and **Logs** tabs (sign-ins, sign-ups, failed sign-ins, admin actions; kept for 180 days).
- The **moderator** role only sees reports and can remove content.

### Android app
The site is also packaged as an Android app (Trusted Web Activity). It is downloaded from `/indir`; when a new version is out, an update banner appears inside the app.

## Running locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. During development, `npm run dev` restarts the server when files change.

## Settings (`.env`)

Copy `.env.example` to `.env` and edit it. Only `SESSION_SECRET` and `ADMIN_SETUP_KEY` are required; anything left empty turns that feature off or falls back to a local default.

| Variable | Description |
|---|---|
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Long random value that signs session cookies |
| `ADMIN_SETUP_KEY` | Secret key asked for when creating the first admin |
| `DB_PATH` | Local database file (default `data/lumora.db`) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | When set, data is stored in a Turso cloud database |
| `NODE_ENV` | `production` when deployed behind HTTPS |
| `APP_URL` | Public address of the site (email links and social sign-in callbacks) |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `MAIL_FROM` | Sends email through the Gmail API (works on hosts that block SMTP ports). Grant access with `npm run gmail-izni` |
| `SMTP_*` | Email over SMTP instead of the Gmail API |
| `TWILIO_*` | SMS verification; when empty, phone sign-up is hidden |
| `GOOGLE_*`, `GITHUB_*` | Social sign-in; providers without keys are hidden |
| `SIGHTENGINE_USER`, `SIGHTENGINE_SECRET` | Automatic photo moderation |

Without email settings, verification links are printed to the server console. Web Push keys are generated on first start and stored in the database.

## Deploying (Render + Turso, free)

1. Create a database and a token on turso.tech.
2. Create a Web Service on Render: build `npm install`, start `npm start`.
3. Environment variables: `NODE_ENV=production`, `SESSION_SECRET`, `ADMIN_SETUP_KEY`, `APP_URL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, plus the keys of any services you want.
4. On the free plan the site sleeps after 15 idle minutes; a monitoring service pinging `/saglik` regularly keeps it awake.

Photos are stored in the database rather than on disk, so Render's ephemeral disk is not a problem.

## First admin

1. Click **Admin girişi** (admin sign-in) in the bottom right of the sign-in page.
2. On the **İlk yönetici kaydı** (first admin) tab, enter the `ADMIN_SETUP_KEY` value and the account details.
3. This works **only once**; further admins are added from the admin panel.

## Project structure

```
src/
  server.js          Express app, page routes, startup tasks
  config.js          Reads .env
  db.js              libsql connection (local / Turso) + versioned schema migrations
  validation.js      Input validation and text moderation
  uploads.js         Image storage (in the database) and photo moderation
  middleware/        auth (sign-in / role checks), rateLimit
  models/            users, posts, follows, messages, stories, notifications,
                     achievements, feedback, safety (blocking, reports), audit (logs)
  routes/            auth, oauth, account, users, posts, messages, stories,
                     notifications, search, reports, feedback, push, admin
  services/          moderation (text + photo), mailer, sms, push,
                     devices, tokens, verification, session, oauthProviders
public/
  index.html         Sign-in / sign-up
  app.html           Feed, profile, messages, settings… (single page)
  admin.html         Admin panel
  indir.html         Android app download page
  sw.js              Service worker for push notifications
  css/style.css      All styles (light / dark theme)
  js/                app.js, messages.js, stories.js, settings.js, admin.js, …
SURUM_NOTLARI.txt    Release notes (Turkish)
```

## Adding features

- **Database:** add a new entry to the `migrations` array in `src/db.js` (never edit existing ones); missing migrations run on startup.
- **Queries:** Turso does not support named parameters (`:id`), so always use `?`.
- **API:** add a router under `src/routes/` and mount it in `server.js` with `app.use('/api/...', ...)`.
- **Achievements:** add a row to `ACHIEVEMENTS` in `src/models/achievements.js`.
- **Blocked words:** edit the `RULES` list in `src/services/moderation.js`.
- **Emoji reactions:** the `REACTIONS` list in `src/models/posts.js`.
