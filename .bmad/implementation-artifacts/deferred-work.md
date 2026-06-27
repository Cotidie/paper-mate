# Deferred Work

Items surfaced during review that are real but intentionally not actioned now.

## Deferred from: code review of story-1-2-open-a-pdf-from-disk (2026-06-28)

- **Upload size cap** [server/app/routes/docs.py:21] — `POST /api/docs` reads the entire PDF into memory (`await file.read()`) with no size limit, so a very large upload could exhaust server memory before validation. Deferred: the deployment is localhost single-user with no auth (AD-1/AD-10), no size limit is specified, and papers are small. Revisit if the app is ever exposed to multiple/untrusted users — add a max-size guard returning 413, or a storage-owned streaming hash path.
