FROM mcr.microsoft.com/playwright/python:v1.47.0-noble

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium (matches our installed playwright version)
RUN playwright install chromium

# Copy application code
COPY . .

# Create data directory for persistent SQLite database
RUN mkdir -p /data

# Use Railway's auto-assigned PORT, default 8080
ENV PORT=8080
ENV DATABASE_PATH=/data/monitors.db

EXPOSE 8080

CMD ["python3", "app.py"]
