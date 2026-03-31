import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const base = mode === 'production' ? env.VITE_PUBLIC_BASE || '/Trip-Planner/' : '/';

  return {
    plugins: [react()],
    base,
  };
});
