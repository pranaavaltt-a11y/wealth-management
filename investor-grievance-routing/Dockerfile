# syntax=docker/dockerfile:1
# One image, several services: the compose file chooses the command for each container.
FROM python:3.12-slim

# Set to "true" to install sentence-transformers (CPU torch) for EMBEDDING_BACKEND=sentence-transformers.
ARG INSTALL_SENTENCE_TRANSFORMERS=false
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONPATH=/app

WORKDIR /app
COPY requirements.txt .
# Behind a TLS-intercepting corporate proxy, pass its CA: docker build --secret id=pipca,src=/path/ca.crt .
RUN --mount=type=secret,id=pipca,required=false \
    if [ -s /run/secrets/pipca ]; then export PIP_CERT=/run/secrets/pipca; fi && \
    pip install -r requirements.txt && \
    if [ "$INSTALL_SENTENCE_TRANSFORMERS" = "true" ]; then \
      pip install --extra-index-url https://download.pytorch.org/whl/cpu torch sentence-transformers; \
    fi

COPY app ./app
COPY prompts ./prompts
COPY corpus ./corpus
COPY contracts ./contracts

RUN useradd --create-home --uid 10001 igr && mkdir -p /data && chown igr /data
USER igr
EXPOSE 8000
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
