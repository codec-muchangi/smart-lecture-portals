# Production image for the Smart Lecture Portal API (SRS 18). Built from ./backend.
FROM python:3.12-slim

# FORWARDED_ALLOW_IPS=*: the hosting platform's proxy sits in front of the container, and uvicorn must trust
# its X-Forwarded-For header so the rate limiter sees real client addresses (the container is not reachable
# except through that proxy). One worker only: rate limits are kept in memory per process.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FORWARDED_ALLOW_IPS=*

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app

# Never run as root.
RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8000'),timeout=4)"]

# Render provides $PORT. Secrets are NEVER baked in: they arrive as environment variables at run time.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
