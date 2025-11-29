import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, '.', '');
  
  return {
    plugins: [react()],
    // This defines process.env variables so they work in the browser environment
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY || ""),
      'process.env.GOOGLE_CLIENT_ID': JSON.stringify(env.GOOGLE_CLIENT_ID || "")
    },
    // Use relative base path for correct asset loading on GitHub Pages
    base: './', 
    server: {
      port: 3000
    }
  };
});
