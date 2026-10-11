// Mock Meet bridge — `npm run meet-bridge [-- --headed] [--port 8788] [--chrome] [--profile DIR]`.
// Prints the pairing code the app asks for. Environment: MOCK_BRIDGE_CODE (fixed code),
// MOCK_BRIDGE_ORIGINS (comma-separated app origins), MOCK_BRIDGE_CHROMIUM (browser binary).

import { parseArgs } from 'node:util';
import { MeetBot } from './bot.ts';
import { DEFAULT_ORIGINS, pairingCode, startBridge } from './server.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8788' },
    headed: { type: 'boolean', default: false },
    chrome: { type: 'boolean', default: false },
    profile: { type: 'string' },
    'any-url': { type: 'boolean', default: false },
  },
});

const token = process.env.MOCK_BRIDGE_CODE || pairingCode();
const origins = (process.env.MOCK_BRIDGE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const time = () => new Date().toTimeString().slice(0, 8);

const bridge = await startBridge({
  port: Number(values.port),
  token,
  origins: origins.length ? origins : DEFAULT_ORIGINS,
  anyUrl: values['any-url'],
  log: (l) => console.log(time() + '  ' + l),
  createBot: (r) => new MeetBot({
    ...r,
    headless: !values.headed,
    channel: values.chrome ? 'chrome' : undefined,
    executablePath: process.env.MOCK_BRIDGE_CHROMIUM || undefined,
    profileDir: values.profile,
  }),
});

console.log(`Mock Meet bridge on ws://127.0.0.1:${bridge.port}\nPairing code: ${token}\nIn Mock: Practice → Interview in Google Meet. Ctrl-C to stop.`);
const stop = () => { void bridge.close().then(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
