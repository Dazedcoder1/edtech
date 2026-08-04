import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['rejoice-semifinal-affair.ngrok-free.dev'],
  },
  // Emit workers as classic scripts rather than ES modules. A module worker is
  // fetched as a module script, which the host must serve with a JavaScript
  // MIME type — the pdf.js worker failed in production for exactly that
  // reason. A classic worker has no such requirement.
  worker: {
    format: 'iife',
  },
})