import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, '.', '');
    var base = mode === 'production' ? env.VITE_PUBLIC_BASE || '/Trip-Planner/' : '/';
    return {
        plugins: [react()],
        base: base,
    };
});
