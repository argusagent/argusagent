# Channel Transcript Scraper — single, dependency-free image.
FROM python:3.12-slim

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app

# Pure standard library: no requirements to install. Copy the app.
COPY core/ ./core/
COPY static/ ./static/
COPY server.py ./

ENV HOST=0.0.0.0 \
    PORT=8000 \
    OUTPUT_DIR=/tmp/scraper-output \
    MAX_VIDEOS=2000 \
    MAX_CONCURRENT_JOBS=2 \
    JOB_TTL_SECONDS=1800 \
    WORKERS=6

RUN mkdir -p /tmp/scraper-output && chown -R appuser:appuser /app /tmp/scraper-output
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=4s --retries=3 \
  CMD python3 -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/healthz',timeout=3)" || exit 1

CMD ["python3", "server.py"]
