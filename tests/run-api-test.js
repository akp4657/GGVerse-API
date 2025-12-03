import 'dotenv/config';
import { spawn } from 'child_process';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const BASE_URL = process.env.APP_URL || 'http://localhost:3000';
let serverProcess = null;

// Wait for server to be ready
async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await axios.get(`${BASE_URL}/`, { timeout: 1000, validateStatus: () => true });
      if (resp.status < 500) return true;
    } catch (e) {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
    process.stdout.write('.');
  }
  return false;
}

// Start server
function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting server...');
    serverProcess = spawn('node', ['app.js'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });

    let output = '';
    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('Server is running')) {
        console.log(' ✓ Server started');
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    serverProcess.on('error', reject);
    setTimeout(() => reject(new Error('Server startup timeout')), 10000);
  });
}

// Stop server
function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }
    console.log('\nStopping server...');
    serverProcess.kill('SIGTERM');
    serverProcess.on('exit', () => {
      console.log('✓ Server stopped');
      resolve();
    });
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL');
        resolve();
      }
    }, 3000);
  });
}

// Run test
async function runTest() {
  return new Promise((resolve, reject) => {
    console.log('\nRunning API endpoints test...\n');
    const testProcess = spawn('node', ['tests/paynetworx-api-endpoints.smoke.js'], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: true
    });

    testProcess.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Test exited with code ${code}`));
    });

    testProcess.on('error', reject);
  });
}

// Main
async function main() {
  try {
    await startServer();
    console.log('Waiting for server to be ready');
    const ready = await waitForServer();
    if (!ready) throw new Error('Server did not become ready');
    console.log(' ✓ Server ready\n');
    
    await runTest();
    await stopServer();
    
    console.log('\n✓ All tests completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    await stopServer();
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await stopServer();
  process.exit(0);
});

main();

