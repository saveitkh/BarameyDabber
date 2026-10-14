# VoxCPM2 Khmer voice-clone API (CPU build for a GPU-less VPS).
#   docker build -t voxcpm .
#   docker run -p 8000:8000 -v voxcpm_models:/models -v voxcpm_voices:/data voxcpm
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    MODELSCOPE_CACHE=/models/modelscope \
    VOICE_DIR=/data/voices \
    BANK_SEED_DIR=/app/voice_bank

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch first: the default PyPI wheels drag in several GB of CUDA libraries.
# torchcodec 0.6 is the release built against torch 2.8.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY voice_bank ./voice_bank

EXPOSE 8000
VOLUME ["/models", "/data"]

# The first start downloads the model (~5 GB) into /models; allow plenty of time.
HEALTHCHECK --interval=60s --timeout=10s --start-period=30m --retries=3 \
    CMD curl -fs http://127.0.0.1:8000/ > /dev/null || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
