import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

// 压缩前端资源，减小首屏传输体积（配合 nginx 的 gzip/brotli 进一步压缩）。
// 不打包（bundle:false）：app.js / style.css 为独立静态资源，仅做 minify。
await build({
  entryPoints: ['app.js'],
  bundle: false,
  minify: true,
  target: 'es2018',
  outfile: 'dist/app.js',
  logLevel: 'info',
});

await build({
  entryPoints: ['style.css'],
  bundle: false,
  minify: true,
  loader: { '.css': 'css' },
  outfile: 'dist/style.css',
  logLevel: 'info',
});

copyFileSync('index.html', 'dist/index.html');
copyFileSync('favicon.svg', 'dist/favicon.svg');

console.log('web build complete -> dist/ (app.js, style.css, index.html, favicon.svg)');
