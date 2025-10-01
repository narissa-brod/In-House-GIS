# Vue 3 + Vite

This template should help get you started developing with Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about IDE Support for Vue in the [Vue Docs Scaling up Guide](https://vuejs.org/guide/scaling-up/tooling.html#ide-support).

## Running this project (local)

1. Install Node.js (includes npm) on Windows: https://nodejs.org/ — ensure `npm` is available in PowerShell.
2. Copy `.env.example` to `.env` and fill in your keys (Google Maps API key and Airtable vars).

PowerShell quick commands:

```powershell
# copy example to .env
Copy-Item -Path .env.example -Destination .env
# install deps
npm install
# run dev server
npm run dev
```

Note: Keep your `.env` out of source control. The project expects Vite env vars prefixed with `VITE_`.
