# Ahadu Glucose Tracker

A personal diabetes blood glucose management web app built with Next.js, Supabase, and GPT-4o AI.

---

## 🚀 Deploy in 4 Steps

### Step 1 — Set up Supabase (free database)

1. Go to **https://supabase.com** and sign up for free
2. Click **"New project"** → name it `ahadu-glucose` → choose a password → click Create
3. Wait ~2 minutes for the project to be ready
4. Go to **SQL Editor** (left sidebar) → click **"New query"**
5. Copy and paste the entire contents of `supabase-schema.sql` and click **Run**
6. Go to **Project Settings → API**
7. Copy your:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)

---

### Step 2 — Push code to GitHub

1. Go to **https://github.com** and create a new repository called `ahadu-glucose`
2. Upload all these project files to the repository
   - Or use GitHub Desktop app to push the folder

---

### Step 3 — Deploy to Vercel (free hosting)

1. Go to **https://vercel.com** and sign up with your GitHub account
2. Click **"New Project"** → import your `ahadu-glucose` repo
3. Before clicking Deploy, click **"Environment Variables"** and add:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
   | `OPENAI_API_KEY` | Your OpenAI API key (sk-proj-...) |

4. Click **Deploy** — Vercel will build and deploy automatically
5. You'll get a URL like: **https://ahadu-glucose.vercel.app**

---

### Step 4 — Add to iPhone Home Screen

1. Open your Vercel URL in **Safari** on your iPhone
2. Tap the **Share button** (box with arrow ↑)
3. Tap **"Add to Home Screen"**
4. Tap **Add**

The app will appear on your home screen like a native app! ✅

---

## Features

- 📊 Record blood glucose for 5 meal slots matching your hospital form
- 🎯 Targets from your doctor: 80-130 before breakfast, 80-180 after meals
- 🤖 GPT-4o AI gives personalized advice after every reading
- 📅 Daily, Weekly, Monthly tables with color-coded status
- 📈 7-day trend chart
- 🧮 Estimated HbA1c calculation
- 🔔 Medication and glucose check reminders
- ☁️ All data saved to Supabase cloud (access from any device)
- 📱 Works like a native iPhone app (PWA)

---

## Tech Stack

- **Next.js 14** — React framework
- **Supabase** — Cloud database (PostgreSQL)
- **Vercel** — Free hosting with automatic deployments
- **OpenAI GPT-4o** — AI health advisor
- **Recharts** — Charts and graphs
- **Tailwind CSS** — Styling
