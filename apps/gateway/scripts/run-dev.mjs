import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(__dirname, '..');

/**
 * `vercel dev` always runs the package.json `dev` script as its framework
 * command. If that script is also `vercel dev`, it recurses.
 *
 * - Outer invocation (pnpm dev): spawn `vercel dev`
 * - Inner invocation (from Vercel): keep-alive only; Vercel serves /api
 */
if (process.env.NOVA_GATEWAY_VERCEL_CHILD === '1') {
  console.log('[gateway] Edge functions served by Vercel Dev');
  setInterval(() => {}, 1 << 30);
} else {
  const require = createRequire(path.join(gatewayRoot, 'package.json'));
  const vercelBin = require.resolve('vercel/dist/index.js');

  const child = spawn(
    process.execPath,
    [vercelBin, 'dev', '--listen', '3002', '--yes'],
    {
      cwd: gatewayRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NOVA_GATEWAY_VERCEL_CHILD: '1',
      },
    },
  );

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}
