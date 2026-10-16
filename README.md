# dev-team-stats

A lightweight web application for tracking AI usage statistics with live persistence to **GitHub Gist**. Built for zero-friction deployment on **Render**, serving the path `/ai-stats`.

---

## 📋 Features

- **Routes:**
  - `https://dev-team-stats.onrender.com/ai-stats` — AI Use Cases Tracker
  - `https://dev-team-stats.onrender.com/hours` — Weekly Hours Tracker (Jett & Fieldglass)
  - *(Root `/` automatically redirects to `/ai-stats`)*
- **AI Use Cases Table Structure:**
  - **Headers:** `Ai UseCase`, `Usege Count`, and `Actions`.
  - **Rows:**
    1. `No of deployment requests raised using kiro`
    2. `No of bugs analyuzed using bug analyzer`
    3. `No of orders raised using order creation tool for unit testing`
    4. `Java upgrade agent use cases`
    5. `AI-SDLC use cases`
- **Increments & Decrements:** `+` (+1) and `&minus;` (-1) buttons with instant visual feedback.
- **Weekly Hours Form (`/hours`):**
  - **Title:** Current Week with dynamically computed Start of Week and End of Week.
  - **Form:** Member Name + 2 boxes (Hours filled in Jett, Hours filled in Fieldglass).
  - **Table:** Real-time team submissions, balanced vs diff comparison, and team totals.
- **Concurrency Safety & Gist Persistence:**
  - Mutex queue serializes all update requests.
  - Persists both `ai-stats.json` and `weekly-hours.json` in your GitHub Gist.

---

## 🚀 Quick Start (Local)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables (optional):**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Add your GitHub Token and Gist ID (if you already have one):
   ```env
   GITHUB_TOKEN=ghp_your_github_token_here
   GIST_ID=your_gist_id_here
   PORT=3000
   ```
   *(If not set in `.env`, you can also configure them directly in the UI modal)*

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open in browser:**
   ```
   http://localhost:3000/ai-stats
   ```

---

## ☁️ Deploying to Render

### Option A: Standard Render Web Service (Recommended)

1. Push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/):
   - Click **New +** &rarr; **Web Service**.
   - Select your GitHub repository.
3. Configure settings:
   - **Name:** `dev-team-stats`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
4. Under **Environment Variables**, add:
   - `GITHUB_TOKEN`: Your GitHub Personal Access Token (with `gist` scope)
   - `GIST_ID`: The ID of your GitHub Gist (e.g. from `https://gist.github.com/username/<GIST_ID>`)
5. Click **Create Web Service**.
6. Once deployed, access the app at:
   ```
   https://dev-team-stats.onrender.com/ai-stats
   ```

---

## 🔑 How to get a GitHub Personal Access Token

1. Go to [GitHub Settings &rarr; Personal Access Tokens &rarr; Tokens (classic)](https://github.com/settings/tokens).
2. Click **Generate new token (classic)**.
3. Give it a note (e.g., `ai-stats-gist`).
4. Check only the **`gist`** scope checkbox (grants full permission to create and edit gists).
5. Click **Generate token** and copy the token.
