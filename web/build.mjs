import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';

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

// index.html 同样去注释 + 压缩空白：剥离全部 HTML 注释、行首缩进、行尾空白，空行折叠为单换行。
// 前提：源文件无内联 <script>，且 <pre>/<textarea> 均为空标签（内容由 JS 运行时填充）——
// 若日后往标签内写默认文本，需先给压缩逻辑加 pre/textarea 保护。
const html = readFileSync('index.html', 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]+/gm, '')
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{2,}/g, '\n');
writeFileSync('dist/index.html', html);
copyFileSync('favicon.svg', 'dist/favicon.svg');

// PWA 静态资源（不压缩，原样拷贝进 dist 供 go:embed 嵌入）
['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']
  .forEach((f) => copyFileSync(f, 'dist/' + f));

// ── 截图识别（tesseract.js）资产本地化 ──────────────────────────────────────
// 引擎原先从 cdn.jsdelivr.net / tessdata 境外站点动态拉取（worker + core + 中英字库约 39MB），
// 弱网或断网直接不可用，手机上还要重复下。这里把运行期真正会用到的 6 个文件拷进
// dist/ocr/v<版本>/，由自己的服务端同源提供：
//   · tesseract.min.js            主线程 SDK（<script> 引入，挂 window.Tesseract）
//   · worker.min.js               createWorker 的 workerPath
//   · tesseract-core-*-lstm.wasm.js  corePath（wasm 已 base64 内联，无独立 .wasm 文件）
//   · lang/*.traineddata.gz       langPath（chi_sim + eng，standard 4.0.0 档位）
// 目录带版本号 + 服务端 immutable 长缓存：升级 tesseract 只换版本目录，用户端无需清缓存。
// 依赖已写进 package.json devDependencies，缺失时给出可执行的修复提示而不是晦涩的 ENOENT。
const OCR_PKG = ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/chi_sim', '@tesseract.js-data/eng'];
const readPkg = (name) => {
  try {
    return JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));
  } catch {
    throw new Error(`缺少 OCR 依赖 ${name}，请先执行：cd web && npm install`);
  }
};
const ocrVer = readPkg('tesseract.js').version;

// app.js 里的 AI_OCR_VER 决定运行时请求哪个版本目录，必须与安装的 tesseract.js 一致。
const appSrc = readFileSync('app.js', 'utf8');
const verMatch = appSrc.match(/const AI_OCR_VER = '([^']+)'/);
if (!verMatch) throw new Error('app.js 缺少 AI_OCR_VER 常量（OCR 资产版本目录）');
if (verMatch[1] !== ocrVer) {
  throw new Error(`app.js AI_OCR_VER='${verMatch[1]}' 与已安装的 tesseract.js@${ocrVer} 不一致，请同步修改`);
}
// 只带 LSTM 内核（createWorker 固定 OEM=LSTM_ONLY）：simd 与回退两份，覆盖老设备。
const OCR_ASSETS = [
  ['tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz', 'lang/chi_sim.traineddata.gz'],
  ['@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];
const ocrDest = `dist/ocr/v${ocrVer}`;
let ocrBytes = 0;
for (const [src, rel] of OCR_ASSETS) {
  const from = `node_modules/${src}`;
  let size = 0;
  try {
    size = statSync(from).size;
  } catch {
    throw new Error(`缺少 OCR 资产 ${from}（${OCR_PKG.join(' / ')} 未正确安装）`);
  }
  const to = `${ocrDest}/${rel}`;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  ocrBytes += size;
}

console.log(
  `web build complete -> dist/ (app.js, style.css, index.html, favicon.svg, manifest.webmanifest, sw.js, icons)\n` +
    `ocr assets -> ${ocrDest}/ (${OCR_ASSETS.length} files, ${(ocrBytes / 1048576).toFixed(1)} MB)`
);
