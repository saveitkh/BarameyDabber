# ====================================================================
# Dockerfile for Cheatz Dabber AI Voice Clone & Dubbing Studio
# Runs the studio as a server (VPS / Render): login required for every API call.
# ====================================================================

# Bookworm: Debian trixie (the new "slim" default) dropped fonts-khmeros-core
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=3000 \
    STUDIO_PUBLIC_MODE=1

# FFmpeg (audio/video), a Khmer font for burned subtitles, curl for the health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-khmeros-core \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch for Demucs: the default wheels pull several GB of CUDA libraries a VPS
# without a GPU cannot use. 2.5.x keeps torchaudio's file backends that Demucs saves with.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Storage directories (mounted as volumes by docker-compose so data survives updates)
RUN mkdir -p uploads outputs samples data scratch

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fs "http://127.0.0.1:${PORT:-3000}/api/system/version" > /dev/null || exit 1

# --proxy-headers: correct client info behind Caddy / Render
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-3000} --proxy-headers --forwarded-allow-ips='*'"]
