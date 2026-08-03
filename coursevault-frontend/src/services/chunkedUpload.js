import { fetchAPI, BASE_URL } from './api.js';

/**
 * Upload a large video in chunks.
 *
 * A single 3GB POST is fragile: one dropped connection at 90% throws away
 * everything, and any proxy or body limit in the chain rejects it outright.
 * Small chunks avoid both, retry individually, and can be sent several at a
 * time — which usually raises throughput too, since the limit is normally
 * per-connection rather than per-link.
 *
 * Chunks are written server-side as separate files and joined at the end, so
 * they may arrive in any order. That is what makes the parallelism safe.
 */

const CHUNK_SIZE = 8 * 1024 * 1024; // small enough to retry cheaply, large enough to keep overhead low
const PARALLEL = 4;
const MAX_RETRIES = 3;

function putChunk(uploadId, index, blob, onBytes, signal) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('uploadId', uploadId);
    form.append('index', String(index));
    form.append('chunk', blob);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/content/upload-chunk`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`);

    let last = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      onBytes(e.loaded - last);
      last = e.loaded;
    };

    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Chunk ${index} failed (${xhr.status})`));

    xhr.onerror = () => reject(new Error(`Network error on chunk ${index}`));
    xhr.onabort = () => reject(new Error('cancelled'));

    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/**
 * @param {File} file
 * @param {object} meta   { moduleId, title, description, preview, folderId }
 * @param {(percent:number)=>void} onProgress
 * @param {{ uploadId?: string, signal?: AbortSignal }} [options]
 */
export async function uploadVideoChunked(file, meta, onProgress = () => {}, options = {}) {
  // Reusing an id resumes that upload; a fresh one starts over.
  const uploadId = options.uploadId || crypto.randomUUID();
  const total = Math.ceil(file.size / CHUNK_SIZE);

  // Ask what the server already holds, so a retry does not resend chunks that
  // arrived before the connection dropped.
  let alreadyHave = new Set();
  try {
    const status = await fetchAPI(`/content/upload-status/${uploadId}`);
    alreadyHave = new Set(status.received || []);
  } catch {
    // A fresh upload has no status yet; not an error.
  }

  let sent = alreadyHave.size * CHUNK_SIZE;
  const bump = (delta) => {
    sent += delta;
    onProgress(Math.min(99, Math.round((sent / file.size) * 100)));
  };

  const queue = [];
  for (let i = 0; i < total; i++) if (!alreadyHave.has(i)) queue.push(i);

  let cursor = 0;
  let failure = null;

  const worker = async () => {
    while (cursor < queue.length && !failure) {
      const index = queue[cursor++];
      const start = index * CHUNK_SIZE;
      const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));

      let attempt = 0;
      for (;;) {
        try {
          await putChunk(uploadId, index, blob, bump, options.signal);
          break;
        } catch (err) {
          if (err.message === 'cancelled') { failure = err; return; }
          if (++attempt > MAX_RETRIES) { failure = err; return; }
          // Back off a little; a momentary drop is the common case.
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));

  if (failure) {
    // Chunks are deliberately left on the server: passing the same uploadId
    // back in resumes rather than restarting.
    failure.uploadId = uploadId;
    throw failure;
  }

  const result = await fetchAPI('/content/upload-finish', {
    method: 'POST',
    body: JSON.stringify({
      uploadId,
      totalChunks: total,
      fileName: file.name,
      title: meta.title,
      description: meta.description,
      preview: meta.preview,
      moduleId: meta.moduleId,
      folderId: meta.folderId,
    }),
  });

  onProgress(100);
  return result;
}

export { CHUNK_SIZE };
