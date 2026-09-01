# BookMyShow Ticket Monitor 🎬

Automatically monitors a BookMyShow movie page every 15 minutes and sends you a Gmail email alert whenever ticket availability changes.

---

## Project Structure

```
bookmyshow-monitor/
├── monitor.py        # Main entry point (run by cron)
├── scraper.py        # Headless Playwright browser scraper
├── notifier.py       # Gmail SMTP email sender
├── state.py          # Snapshot diffing and persistence
├── config.yaml       # ← Edit this with your details
├── state.json        # Auto-generated; stores last known snapshot
├── monitor.log       # Auto-generated; cron log output
├── requirements.txt
├── setup.sh          # One-time setup
└── install_cron.sh   # Install macOS cron job
```

---

## Step 1 — Setup (run once)

```bash
cd /path/to/bookmyshow-monitor
bash setup.sh
```

This installs Python dependencies and downloads the Playwright Chromium browser (~150 MB).

---

## Step 2 — Configure

Open **`config.yaml`** and fill in:

```yaml
email:
  from: "your.gmail@gmail.com"
  to:   "alerts@example.com"
  app_password: "xxxx xxxx xxxx xxxx"   # ← see below
```

### Getting a Gmail App Password

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Sign in → click **"Create App Password"**
3. Name it `bms-monitor` → copy the 16-character password
4. Paste it into `config.yaml` (spaces are fine — Gmail ignores them)

> **Note**: You need 2-Step Verification enabled on your Google account first.

---

## Step 3 — Test email

```bash
python3 notifier.py --test
```

You should receive a test email within 30 seconds.

---

## Step 4 — Test the scraper

```bash
python3 monitor.py --dry-run
```

This fetches the BookMyShow page and prints what it found — no email is sent, nothing is saved.

---

## Step 5 — First real run

```bash
python3 monitor.py
```

This saves the current snapshot to `state.json`. No email is sent on the first run (nothing to compare against yet).

---

## Step 6 — Install cron (automatic monitoring)

```bash
bash install_cron.sh
```

This sets up a macOS cron job that runs `monitor.py` every 15 minutes. Logs go to `monitor.log`.

```bash
# Watch live logs
tail -f monitor.log

# Remove the cron job
crontab -l | grep -v '# bms-monitor' | crontab -
```

---

## What the email looks like

When something changes you'll get an email like:

| Theatre | Showtime | Change |
|---|---|---|
| PVR Forum | 06:30 PM | 🟢 Tickets opened up! |
| INOX GVK One | 09:15 PM | 🆕 New show added |
| Cinepolis | 03:00 PM | 🔴 Now sold out |

With a **"Book Tickets on BookMyShow →"** button linking directly to the movie page.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Scraper finds 0 theatres | BookMyShow blocked the request. It will retry next run automatically. |
| Gmail auth error | Make sure you're using an **App Password**, not your regular Gmail password. |
| Cron not firing | Ensure cron has disk access on macOS: System Settings → Privacy → Full Disk Access → add `cron`. |
| No state.json after first run | Check `monitor.log` for errors. |

---

## Adding more movies to monitor

Edit `config.yaml` and add entries under `targets`:

```yaml
targets:
  - name: "Bethlehem Kudumba Unit"
    url: "https://in.bookmyshow.com/movies/secunderabad/bethlehem-kudumba-unit/ET00502829"
    city: "Secunderabad"
    theatres: []

  - name: "Another Movie"
    url: "https://in.bookmyshow.com/..."
    city: "Hyderabad"
    theatres: ["PVR: Inorbit Mall"]   # optional: filter to specific theatres
```
