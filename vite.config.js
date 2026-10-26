import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({plugins:[react(),VitePWA({registerType:'autoUpdate',includeAssets:['icon.svg'],manifest:{name:'Speffz Lab — 3BLD Trainer',short_name:'Speffz Lab',description:'Practice 3BLD Speffz sticker recognition.',theme_color:'#10151d',background_color:'#10151d',display:'standalone',orientation:'portrait',start_url:'/',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]},workbox:{globPatterns:['**/*.{js,css,html,svg,woff2}']}})]});
