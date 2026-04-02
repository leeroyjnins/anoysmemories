# ✦ Memory Wall

A beautiful, real-time photo gallery for events. Guests scan a QR code, upload photos and memories, and everyone can watch the wall grow live.

## Stack

- **React + Vite** — frontend
- **Supabase** — database, storage, and real-time
- **Vercel** — free hosting
- **qrcode.react** — built-in QR code generator

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. Open the **SQL Editor** and run the contents of `supabase-setup.sql`
3. Go to **Storage** → create a bucket named `memory-wall` → set it to **Public**
4. In Storage Policies, allow public `SELECT` and `INSERT`

### 3. Add environment variables

```bash
cp .env.example .env
```

Fill in your values from **Supabase → Settings → API**:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Run locally

```bash
npm run dev
```

Visit `http://localhost:5173`

---

## Deploy to Vercel

```bash
git init
git add .
git commit -m "initial commit"
# Push to GitHub, then import the repo on vercel.com
```

In Vercel **Settings → Environment Variables**, add:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Your live URL will be something like `https://memory-wall.vercel.app`

---

## Using the QR code

1. Deploy the app and get your live URL
2. Go to the **QR code** page in the app
3. Choose whether the QR points to the Gallery or Upload page
4. Download the PNG and print it on table cards

---

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Gallery — masonry grid of all photos, real-time |
| `/upload` | Upload form — camera capture, name, caption, note |
| `/qr` | QR code generator — download + copy link |

---

## Customisation tips

- **Event name**: Change "Memory Wall" in `index.html` `<title>` and `App.jsx`
- **Passcode gate**: Wrap `<UploadForm>` in App.jsx with a simple password check using `useState`
- **Moderation**: Add an `approved boolean default false` column to the table and filter the gallery query to `where approved = true`
- **Slideshow mode**: Add a `/slideshow` route that cycles through photos full-screen — great for displaying on a TV at the event
