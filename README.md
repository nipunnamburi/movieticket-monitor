# BookMyShow Ticket Monitor 🎬

A modern BookMyShow ticket availability monitor with Web UI, automated diff detection, and Gmail email alerts. Supports both serverless cloud deployments (Vercel + Neon Postgres + GitHub Actions) and local/self-hosted runs.

---

## Key Features

- 📱 **Responsive Web UI**: Manage monitors, filter theatres/dates/times, track alert history, and trigger instant manual checks.
- ⚡ **Automated Diffing**: Tracks show additions, ticket availability changes, and sold-out states.
- 📧 **Gmail SMTP Alerts**: Clean HTML & plain text alert notifications delivered straight to your inbox.
- ☁️ **Dual Deployment**: Run serverless on Vercel with Neon Postgres and GitHub Actions, or locally with SQLite.

---

## Project Structure

```
bookmyshow-monitor/
├── app.py                     # Unified Flask Web App & REST API
├── db.py                      # Unified Database Layer (Neon Postgres / SQLite)
├── scraper.py                 # Playwright Headless Browser Scraper
├── state.py                   # Snapshot Diffing Engine
├── notifier.py                # Gmail SMTP Email Alert Sender
├── actions_runner.py          # GitHub Actions / Automated Monitor Runner
├── monitor.py                 # CLI entry point
├── static/                    # Frontend assets (app.js, Tailwind)
├── templates/                 # Web UI template (index.html)
├── vercel.json                # Vercel deployment config
└── .github/workflows/         # GitHub Actions workflow for scheduled runs
```

---

## Quick Start (Local Development)

### 1. Installation

```bash
bash setup.sh
```

### 2. Run the Web Application

```bash
python3 app.py
```

Open `http://localhost:5055` in your browser.

### 3. Add a Monitor

1. Open the Web UI at `http://localhost:5055`.
2. Configure your Gmail email credentials under **Email Setup** (or via environment variables).
3. Paste a BookMyShow movie/event URL and click **Start Monitoring**.

---

## Cloud Deployment (Vercel + Neon + GitHub Actions)

### Environment Variables

Set the following environment variables in your Vercel project and GitHub repository secrets:

- `DATABASE_URL`: Neon PostgreSQL connection string (`postgresql://...`)
- `EMAIL_FROM`: Sender Gmail address
- `EMAIL_APP_PASSWORD`: Gmail 16-character App Password
- `EMAIL_TO`: Default recipient email address
- `GITHUB_TOKEN`: Personal Access Token (for manual "Check Now" triggers)
- `GITHUB_REPO`: `owner/repository`

---

## CLI Usage

```bash
# Check all active monitors in the database
python3 monitor.py

# Test scrape without saving or emailing
python3 monitor.py --dry-run

# Check a specific monitor ID
python3 monitor.py --monitor-id 1
```
