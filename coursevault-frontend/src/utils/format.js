export const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  // Videos are capped at 3GB, which stopped here reading as "3072.0 MB".
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
};

const tagColors = ['bg-[#87CEFA]', 'bg-[#A7E2D1]', 'bg-[#F9E076]'];
const bgColors = ['bg-[#F4F4F4]', 'bg-[#A7E2D1]', 'bg-[#7AA5E6]', 'bg-[#E63946]', 'bg-[#A084E8]', 'bg-[#8A2BE2]'];

// Helper to reliably map UUID strings to consistent numbers for colors
const getHash = (id) => {
  if (!id) return 0;
  if (typeof id === 'string') {
    return id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  }
  return id;
};

export const getTagColor = (id) => tagColors[getHash(id) % tagColors.length];
export const getBgColor = (id) => bgColors[getHash(id) % bgColors.length];