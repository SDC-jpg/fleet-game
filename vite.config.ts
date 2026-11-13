import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { shipArtPlugin } from './tools/shipart-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), shipArtPlugin()],
  // Built files find each other with relative paths, so the game works at any
  // web address, e.g. https://<user>.github.io/fleet-game/
  base: './',
  // When this version was built (shown with the version number at the bottom right).
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: {
    // Two pages: the game, and the ShipArt tool.
    rollupOptions: { input: { main: 'index.html', shipart: 'shipart.html' } },
  },
  server: {
    // The project folder lives on Windows and is shared into the Docker container,
    // so file-change alerts don't always arrive. Check for changes on a timer instead.
    watch: { usePolling: true, interval: 300 },
  },
})
