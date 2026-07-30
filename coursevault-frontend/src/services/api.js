// Detect the backend base URL dynamically
const getBaseUrl = () => {
  if (window.location.hostname === 'localhost') {
    return import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
  }
  return window.location.origin + '/api';
};

const BASE_URL = getBaseUrl();

/**
 * Exported so components building their own fetch calls (image uploads, which
 * need multipart bodies) resolve the API the same way fetchAPI does.
 * Reading import.meta.env.VITE_API_URL directly is a trap: it is undefined in
 * local dev, producing a request to the literal URL "undefined/content/...".
 */
export { BASE_URL };

// Appends moduleId directly to FormData body instead of URL Query Params
export const uploadVideoWithProgress = (moduleId, file, title, description, onProgress) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const token = localStorage.getItem('token');
    const formData = new FormData();

    // Backend's videoUpload multer config is `videoUpload.single("file")`
    // — it only reads a field literally named "file".
    formData.append('file', file);
    formData.append('moduleId', moduleId);
    formData.append('title', title || '');
    formData.append('description', description || '');

    // Track real-time uploading logs
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        if (onProgress) onProgress(percentComplete);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (_) {
          resolve(xhr.responseText);
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new Error(errData.error || `Upload failed with status: ${xhr.status}`));
        } catch (_) {
          reject(new Error(`Upload failed with status: ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network upload error occurred.')));

    // Cleaned endpoint path without trailing query parameter pollution
    xhr.open('POST', `${BASE_URL}/content/upload-video`);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
};

// Existing fetchAPI Utility
export const fetchAPI = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
    const contentType = response.headers.get("content-type");
    const data = contentType?.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
      throw new Error(data?.error || data || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error(`API Fetch Error [${endpoint}]:`, error);
    throw error;
  }
};