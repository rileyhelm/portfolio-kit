import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const outputDir = 'static/build';

const entryPoints = {
  public: 'static/ts/public/index.ts',
  edit: 'static/ts/edit/index.ts',
};

const existingEntries = Object.entries(entryPoints)
  .filter(([, value]) => existsSync(join(__dirname, value)))
  .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

if (Object.keys(existingEntries).length === 0) {
  console.log('No frontend entry points found.');
  process.exit(0);
}

function prepareOutputDir() {
  rmSync(join(__dirname, outputDir), { recursive: true, force: true });
  mkdirSync(join(__dirname, outputDir), { recursive: true });
}

const buildOptions = {
  entryPoints: existingEntries,
  bundle: true,
  outdir: outputDir,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: isWatch,
  minify: !isWatch,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
};

async function build() {
  prepareOutputDir();
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
    return;
  }
  await esbuild.build(buildOptions);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});

