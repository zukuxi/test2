// X3 PDF Converter
// Original mode + text reflow mode
// XTC / XTCH, local processing

const $ = id => document.getElementById(id);

let chosen = [];
let cancelled = false;
let running = false;
let previewing = false;
let pdfjsPromise = null;
let previewTimer = null;

let PAGE_W = 528;
let PAGE_H = 792;

$('pick').onclick = () => $('pdfs').click();

$('pdfs').addEventListener('change', () => {
  chosen = Array.from($('pdfs').files || []);

  $('fileInfo').textContent = chosen.length
    ? '已选择 ' + chosen.length + ' 个 PDF：\n' +
      chosen.map(f => f.name + '（' + (f.size / 1048576).toFixed(2) + ' MB）').join('\n')
    : '尚未选择 PDF。';

  $('start').disabled = !chosen.length || running;
  $('previewBtn').disabled = !chosen.length || running;
  $('previewGrid').innerHTML = '';

  if (chosen.length) {
    $('previewInfo').textContent = '正在生成转换预览…';
    previewFirst();
  } else {
    $('previewInfo').textContent = '请选择 PDF 文件。';
  }
});

$('previewBtn').onclick = () => previewFirst();
$('start').onclick = () => runConversion();

$('cancel').onclick = () => {
  cancelled = true;
  $('cancel').disabled = true;
  setStatus('正在取消…');
};

[
  'depth', 'trim', 'trimDistance', 'scale',
  'dither', 'contrast', 'brightness',
  'convertMode', 'orientation'
].forEach(id => {
  const el = $(id);
  if (!el) return;

  el.addEventListener('change', () => {
    updateOrientation();
    if (!chosen.length || running) return;

    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!previewing) previewFirst();
    }, 250);
  });
});

function updateOrientation() {
  const direction = $('orientation')?.value || 'portrait';

  if (direction === 'landscape') {
    PAGE_W = 792;
    PAGE_H = 528;
  } else {
    PAGE_W = 528;
    PAGE_H = 792;
  }
}

function setStatus(t, p) {
  $('progressText').textContent = t;
  if (p !== undefined) {
    $('bar').style.width = Math.max(0, Math.min(100, p)) + '%';
  }
}

function safeName(s) {
  return (s || 'document')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'document';
}

function yieldUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/legacy/build/pdf.mjs'
    );
  }
  return pdfjsPromise;
}

async function openPdf(file) {
  const pdfjs = await getPdfjs();

  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.mjs';

  const data = new Uint8Array(await file.arrayBuffer());

  return await pdfjs.getDocument({
    data,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/cmaps/',
    cMapPacked: true,
    standardFontDataUrl:
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/standard_fonts/',
    useSystemFonts: true,
    disableFontFace: false,
    fontExtraProperties: true
  }).promise;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function rotateCanvas(src) {
  const out = canvas(src.height, src.width);
  const ctx = out.getContext('2d');

  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);

  src.width = 1;
  src.height = 1;
  return out;
}

function cropCanvas(src, x, y, w, h) {
  const out = canvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

async function renderPdfPage(pdf, n, scale) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });

  const c = canvas(viewport.width, viewport.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);

  await page.render({
    canvasContext: ctx,
    viewport,
    background: 'rgb(255,255,255)'
  }).promise;

  page.cleanup();

  // 原样模式：竖版原图顺时针转成横向，方便按阅读顺序切分。
  if (c.width < c.height) return rotateCanvas(c);

  return c;
}

// 白边检测
function trimWhite(src, mode, customDistance = 0) {
  if (mode === 'off' && customDistance <= 0) return src;

  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, w, h).data;

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  if (mode !== 'off') {
    const strong = mode === 'strong';
    const threshold = strong ? 246 : 250;
    const whiteRatio = strong ? 0.975 : 0.992;

    const maxX = Math.floor(w * (strong ? 0.28 : 0.20));
    const maxY = Math.floor(h * (strong ? 0.28 : 0.20));

    const rowWhite = y => {
      let total = 0;
      let white = 0;
      const step = Math.max(1, Math.floor(w / 1200));

      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const lum =
          0.299 * data[i] +
          0.587 * data[i + 1] +
          0.114 * data[i + 2];

        total++;
        if (lum >= threshold) white++;
      }

      return white / Math.max(1, total);
    };

    const colWhite = x => {
      let total = 0;
      let white = 0;
      const step = Math.max(1, Math.floor(h / 1200));

      for (let y = 0; y < h; y += step) {
        const i = (y * w + x) * 4;
        const lum =
          0.299 * data[i] +
          0.587 * data[i + 1] +
          0.114 * data[i + 2];

        total++;
        if (lum >= threshold) white++;
      }

      return white / Math.max(1, total);
    };

    while (top < maxY && rowWhite(top) > whiteRatio) top++;
    while (bottom > h - 1 - maxY && rowWhite(bottom) > whiteRatio) bottom--;
    while (left < maxX && colWhite(left) > whiteRatio) left++;
    while (right > w - 1 - maxX && colWhite(right) > whiteRatio) right--;

    const safety = 2;
    top = Math.max(0, top - safety);
    left = Math.max(0, left - safety);
    bottom = Math.min(h - 1, bottom + safety);
    right = Math.min(w - 1, right + safety);
  }

  // 自定义距离：在自动白边检测结果上额外裁切指定像素。
  if (customDistance > 0) {
    top += customDistance;
    bottom -= customDistance;
    left += customDistance;
    right -= customDistance;
  }

  if (
    right - left < w * 0.25 ||
    bottom - top < h * 0.25 ||
    right <= left ||
    bottom <= top
  ) {
    return src;
  }

  const out = cropCanvas(
    src,
    left,
    top,
    right - left + 1,
    bottom - top + 1
  );

  src.width = 1;
  src.height = 1;
  return out;
}

// 将一张图片完整适配到当前 X3 页面，不拉伸、不裁切。
function fitPage(src, width = PAGE_W, height = PAGE_H) {
  const out = canvas(width, height);
  const ctx = out.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scale = Math.min(width / src.width, height / src.height);
  const dw = src.width * scale;
  const dh = src.height * scale;

  ctx.drawImage(
    src,
    (width - dw) / 2,
    (height - dh) / 2,
    dw,
    dh
  );

  return out;
}

// 原样转换：竖版页面旋转后，必须从右向左输出。
// 这样对应原 PDF 的顶部 → 中间 → 底部。
function splitThree(page, trimMode, customDistance = 0) {
  const trimmed = trimWhite(page, trimMode, customDistance);
  const w = trimmed.width;
  const h = trimmed.height;

  const cuts = [
    0,
    Math.round(w / 3),
    Math.round(w * 2 / 3),
    w
  ];

  const order = pageWasPortrait ? [2, 1, 0] : [0, 1, 2];
  const out = [];

  for (const i of order) {
    const part = cropCanvas(
      trimmed,
      cuts[i],
      0,
      cuts[i + 1] - cuts[i],
      h
    );

    out.push(fitPage(part));
    part.width = 1;
    part.height = 1;
  }

  trimmed.width = 1;
  trimmed.height = 1;

  return out;
}

let pageWasPortrait = false;

async function renderOriginalPage(pdf, n, scale, trimMode, customDistance) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });

  pageWasPortrait = viewport.width < viewport.height;

  page.cleanup();

  const rendered = await renderPdfPage(pdf, n, scale);
  const pieces = splitThree(rendered, trimMode, customDistance);

  rendered.width = 1;
  rendered.height = 1;

  return pieces;
}

// 文字型 PDF 重新排版。
// 按文字坐标恢复行，再按 X3 页面高度重新分页。
async function renderReflowPages(pdf, n, scale) {
  const page = await pdf.getPage(n);
  const textContent = await page.getTextContent({
    includeMarkedContent: true
  });

  const items = (textContent.items || []).filter(
    item => item.str && item.str.trim()
  );

  // 无文字层：扫描 PDF 无法进行文字重排。
  if (!items.length) {
    page.cleanup();
    return null;
  }

  // 检查是否存在图片对象。
  // 混合图文页保留原样，避免重排时丢失插图。
  let hasImages = false;

  try {
    const ops = await page.getOperatorList();
    const pdfjs = await getPdfjs();

    const imageOps = [
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintJpegXObject,
      pdfjs.OPS.paintImageMaskXObject,
      pdfjs.OPS.paintInlineImageXObject
    ].filter(v => v !== undefined);

    hasImages = ops.fnArray.some(fn => imageOps.includes(fn));
  } catch (_) {
    hasImages = true;
  }

  if (hasImages) {
    page.cleanup();
    return null;
  }

  const viewport = page.getViewport({ scale });
  const groups = [];

  for (const item of items) {
    const tx = item.transform || [];
    const x = tx[4] || 0;
    const y = tx[5] || 0;
    const fontSize = Math.max(8, Math.abs(tx[3] || tx[0] || 10));

    const vx = x * scale;
    const vy = viewport.height - y * scale;
    const size = fontSize * scale;

    let line = groups.find(g => Math.abs(g.y - vy) < size * 0.55);

    if (!line) {
      line = { y: vy, items: [], size };
      groups.push(line);
    }

    line.items.push({
      x: vx,
      text: item.str,
      size
    });

    line.size = Math.max(line.size, size);
  }

  groups.sort((a, b) => a.y - b.y);

  for (const line of groups) {
    line.items.sort((a, b) => a.x - b.x);
  }

  const lines = groups.map(line => {
    return {
      text: line.items.map(v => v.text).join(''),
      size: line.size
    };
  }).filter(line => line.text.trim());

  page.cleanup();

  if (!lines.length) return null;

  const pages = [];
  let current = canvas(PAGE_W, PAGE_H);
  let ctx = current.getContext('2d');

  let y = 28;
  const margin = 28;
  const usableWidth = PAGE_W - margin * 2;

  function newPage() {
    pages.push(current);
    current = canvas(PAGE_W, PAGE_H);
    ctx = current.getContext('2d');
    y = 28;
  }

  function drawTextLine(text, size) {
    const fontSize = Math.max(11, Math.min(25, size * 0.82));

    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = '#111';

    const chars = Array.from(text);
    let buffer = '';

    for (const ch of chars) {
      const next = buffer + ch;

      if (
        buffer &&
        ctx.measureText(next).width > usableWidth
      ) {
        if (y + fontSize + 8 > PAGE_H - margin) newPage();

        ctx.fillText(buffer, margin, y + fontSize);
        y += fontSize * 1.45;
        buffer = ch;
      } else {
        buffer = next;
      }
    }

    if (buffer) {
      if (y + fontSize + 8 > PAGE_H - margin) newPage();

      ctx.fillText(buffer, margin, y + fontSize);
      y += fontSize * 1.45;
    }
  }

  for (const line of lines) {
    drawTextLine(line.text, line.size);
  }

  if (y > 28 || !pages.length) pages.push(current);

  return pages;
}

function canvasToGray(c) {
  const w = c.width;
  const h = c.height;
  const d = c.getContext('2d', {
    willReadFrequently: true
  }).getImageData(0, 0, w, h).data;

  const gray = new Uint8Array(w * h);

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = Math.round(
      0.299 * d[i] +
      0.587 * d[i + 1] +
      0.114 * d[i + 2]
    );
  }

  return gray;
}

function contrastGray(gray, mode) {
  const factors = {
    none: 1,
    light: 1.10,
    medium: 1.25,
    strong: 1.45,
    maximum: 1.70
  };

  const factor = factors[mode] ?? 1;
  if (factor === 1) return new Uint8Array(gray);

  const out = new Uint8Array(gray.length);

  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(
      0,
      Math.min(
        255,
        Math.round((gray[i] - 127.5) * factor + 127.5)
      )
    );
  }

  return out;
}

function brightnessGray(gray, brightness) {
  const amount = Number(brightness) || 0;
  if (amount === 0) return new Uint8Array(gray);

  const out = new Uint8Array(gray.length);

  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(
      0,
      Math.min(255, gray[i] + amount * 2)
    );
  }

  return out;
}

function dither(
  gray, w, h, mode, depth,
  contrast = 'none',
  brightness = 0,
  ditherStrength = 100,
  threshold = 128
) {
  const adjusted = brightnessGray(
    contrastGray(gray, contrast),
    brightness
  );

  const a = new Float32Array(adjusted);
  const matrix = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  const clamp = v => Math.max(0, Math.min(255, v));
  const strength = Math.max(
    0,
    Math.min(100, Number(ditherStrength) || 0)
  ) / 100;

  const binaryThreshold = Math.max(
    0,
    Math.min(255, Number(threshold) || 128)
  );

  const quantize = v => {
    v = clamp(v);

    if (depth !== 2) {
      return v < binaryThreshold ? 0 : 255;
    }

    return v < 42.5 ? 0 :
      v < 127.5 ? 85 :
      v < 212.5 ? 170 : 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = clamp(a[i]);

      if (mode === 'ordered') {
        const step = depth === 2 ? 85 : 255;
        const bias =
          ((matrix[y & 3][x & 3] + 0.5) / 16 - 0.5) *
          step * strength;

        a[i] = quantize(old + bias);
        continue;
      }

      const value = quantize(old);
      a[i] = value;

      if (mode === 'none' || strength === 0) continue;

      const error = (old - value) * strength;

      const add = (xx, yy, weight, divisor) => {
        if (xx >= 0 && xx < w && yy < h) {
          a[yy * w + xx] += error * weight / divisor;
        }
      };

      if (mode === 'atkinson') {
        add(x + 1, y, 1, 8);
        add(x + 2, y, 1, 8);
        add(x - 1, y + 1, 1, 8);
        add(x, y + 1, 1, 8);
        add(x + 1, y + 1, 1, 8);
        add(x, y + 2, 1, 8);
      } else if (mode === 'sierra-lite') {
        add(x + 1, y, 2, 4);
        add(x - 1, y + 1, 1, 4);
        add(x, y + 1, 1, 4);
      } else {
        add(x + 1, y, 7, 16);
        add(x - 1, y + 1, 3, 16);
        add(x, y + 1, 5, 16);
        add(x + 1, y + 1, 1, 16);
      }
    }
  }

  return Uint8Array.from(a, v => Math.round(clamp(v)));
}

function makePage(magic, w, h, data) {
  const out = new Uint8Array(22 + data.length);
  const view = new DataView(out.buffer);

  for (let i = 0; i < 4; i++) {
    out[i] = magic.charCodeAt(i);
  }

  view.setUint16(4, w, true);
  view.setUint16(6, h, true);

  out[8] = 0;
  out[9] = 0;

  view.setUint32(10, data.length, true);
  out.set(data, 22);
  out.set(md5(data).slice(0, 8), 14);

  return out;
}

function packXTG(px, w, h) {
  const rowBytes = Math.ceil(w / 8);
  const data = new Uint8Array(rowBytes * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y * w + x] >= 128) {
        data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return makePage('XTG\0', w, h, data);
}

function packXTH(px, w, h) {
  const columnBytes = Math.ceil(h / 8);
  const plane = columnBytes * w;

  const p0 = new Uint8Array(plane);
  const p1 = new Uint8Array(plane);

  for (let x = 0; x < w; x++) {
    const offset = (w - 1 - x) * columnBytes;

    for (let y = 0; y < h; y++) {
      const p = px[y * w + x];
      const value = p >= 212 ? 0 :
        p >= 127 ? 1 :
        p >= 42 ? 2 : 3;

      const index = offset + (y >> 3);
      const bit = 7 - (y & 7);

      if (value & 1) p0[index] |= 1 << bit;
      if (value & 2) p1[index] |= 1 << bit;
    }
  }

  const data = new Uint8Array(plane * 2);
  data.set(p0);
  data.set(p1, plane);

  return makePage('XTH\0', w, h, data);
}

function md5(input) {
  const K = new Uint32Array(64);
  const S = [
    7,12,17,22,5,9,14,20,
    4,11,16,23,6,10,15,21,
    4,11,16,23,6,10,15,21,
    4,11,16,23,6,10,15,21
  ];

  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(
      Math.abs(Math.sin(i + 1)) * 4294967296
    ) >>> 0;
  }

  const len = input.length;
  const bitLen = len * 8;
  const total = ((len + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(total);

  msg.set(input);
  msg[len] = 128;

  const mdv = new DataView(msg.buffer);
  mdv.setUint32(total - 8, bitLen >>> 0, true);
  mdv.setUint32(
    total - 4,
    Math.floor(bitLen / 4294967296),
    true
  );

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < total; offset += 64) {
    const M = new Uint32Array(16);
    const dv = new DataView(msg.buffer, offset, 64);

    for (let i = 0; i < 16; i++) {
      M[i] = dv.getUint32(i * 4, true);
    }

    let a = a0, b = b0, c = c0, d = d0;

    for (let i = 0; i < 64; i++) {
      let f, g;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const s = i < 16 ? S[i % 4] :
        i < 32 ? S[4 + i % 4] :
        i < 48 ? S[8 + i % 4] :
        S[12 + i % 4];

      const z = (a + f + K[i] + M[g]) | 0;
      const r = (z << s) | (z >>> (32 - s));

      a = d;
      d = c;
      c = b;
      b = (b + r) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);

  [a0, b0, c0, d0].forEach((v, i) => {
    dv.setUint32(i * 4, v, true);
  });

  return out;
}

function buildBook(pages, is2, title) {
  if (pages.length > 65535) {
    throw new Error('页面数量超过 XTC 容器可表示的上限。');
  }

  const metaOff = 56;
  const indexOff = 312;
  const dataOff = indexOff + pages.length * 16;

  const total = dataOff + pages.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);

  const magic = is2 ? 'XTCH' : 'XTC\0';

  for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i);

  v.setUint16(4, 1, true);
  v.setUint16(6, pages.length, true);
  v.setUint32(8, 0x01000100, true);
  v.setUint32(12, 1, true);

  v.setBigUint64(16, BigInt(metaOff), true);
  v.setBigUint64(24, BigInt(indexOff), true);
  v.setBigUint64(32, BigInt(dataOff), true);
  v.setBigUint64(40, 0n, true);
  v.setBigUint64(48, 0n, true);

  out.set(new TextEncoder().encode(title).slice(0, 127), metaOff);

  let pos = dataOff;

  pages.forEach((p, i) => {
    const e = indexOff + i * 16;

    v.setBigUint64(e, BigInt(pos), true);
    v.setUint32(e + 8, p.length, true);
    v.setUint16(e + 12, PAGE_W, true);
    v.setUint16(e + 14, PAGE_H, true);

    out.set(p, pos);
    pos += p.length;
  });

  return out;
}

async function makeOutputPage(c, depth, algo, contrast, brightness) {
  const w = c.width;
  const h = c.height;

  const gray = canvasToGray(c);
  const processed = dither(
    gray, w, h,
    algo, depth,
    contrast, brightness,
    100, 128
  );

  return depth === 2
    ? packXTH(processed, w, h)
    : packXTG(processed, w, h);
}

async function createPagesForPdf(pdf, options, limit = Infinity, keepCanvases = false) {
  const output = [];
  const pageTotal = pdf.numPages;

  for (let n = 1; n <= pageTotal; n++) {
    if (cancelled || output.length >= limit) break;

    let canvases = [];

    if (options.mode === 'reflow') {
      canvases = await renderReflowPages(pdf, n, options.scale);

      // 扫描页、复杂图文页无法安全提取重排时，退回原样。
      if (!canvases) {
        canvases = await renderOriginalPage(
          pdf, n, options.scale,
          options.trimMode,
          options.trimDistance
        );
      }
    } else {
      canvases = await renderOriginalPage(
        pdf, n, options.scale,
        options.trimMode,
        options.trimDistance
      );
    }

    for (const c of canvases) {
      if (output.length >= limit) {
        c.width = 1;
        c.height = 1;
        break;
      }

      const bytes = await makeOutputPage(
        c,
        options.depth,
        options.algo,
        options.contrast,
        options.brightness
      );

      output.push({
        bytes,
        canvas: c
      });

      // 预览需要在生成 PNG 前保留画布；正式转换仍立即释放，控制内存。
      if (!keepCanvases) {
        c.width = 1;
        c.height = 1;
      }
    }

    canvases.length = 0;
    await yieldUI();
  }

  return output;
}

function getOptions() {
  updateOrientation();

  return {
    depth: Number($('depth').value),
    mode: $('convertMode')?.value || 'original',
    trimMode: $('trim').value,
    trimDistance: Math.max(
      0,
      Number($('trimDistance')?.value || 0)
    ),
    scale: Number($('scale').value),
    algo: $('dither').value,
    contrast: $('contrast').value,
    brightness: Number($('brightness').value)
  };
}

async function previewFirst() {
  if (!chosen.length || previewing || running) return;

  previewing = true;
  $('previewBtn').disabled = true;
  $('previewGrid').innerHTML = '';
  $('previewInfo').textContent = '正在生成前 10 张最终输出页面…';

  let pdf;

  try {
    const options = getOptions();
    pdf = await openPdf(chosen[0]);

    const pages = await createPagesForPdf(pdf, options, 10, true);

    for (let i = 0; i < pages.length; i++) {
      const c = pages[i].canvas;
      const box = document.createElement('div');
      box.className = 'preview-card';

      const label = document.createElement('div');
      label.textContent = '第 ' + (i + 1) + ' 页';

      const img = document.createElement('img');
      img.alt = label.textContent;
      img.src = c.toDataURL('image/png');

      box.append(label, img);
      $('previewGrid').append(box);
    }

    $('previewInfo').textContent =
      '已显示前 ' + pages.length +
      ' 张最终输出页面。预览尺寸：' +
      PAGE_W + ' × ' + PAGE_H + '。';

    pages.forEach(p => {
      p.canvas.width = 1;
      p.canvas.height = 1;
    });

  } catch (e) {
    $('previewInfo').textContent =
      '预览失败：' + (e?.message || e);
  } finally {
    try {
      await pdf?.destroy();
    } catch (_) {}

    previewing = false;
    $('previewBtn').disabled = running || !chosen.length;
  }
}

async function runConversion() {
  if (running || !chosen.length) return;

  running = true;
  cancelled = false;

  $('start').disabled = true;
  $('pick').disabled = true;
  $('previewBtn').disabled = true;
  $('cancel').disabled = false;

  const options = getOptions();
  let completed = 0;

  try {
    for (let fi = 0; fi < chosen.length; fi++) {
      if (cancelled) break;

      const file = chosen[fi];
      let pdf = null;

      try {
        pdf = await openPdf(file);

        const pageTotal = pdf.numPages;
        const pages = [];

        for (let n = 1; n <= pageTotal; n++) {
          if (cancelled) break;

          let canvases = [];

          if (options.mode === 'reflow') {
            canvases = await renderReflowPages(pdf, n, options.scale);

            if (!canvases) {
              canvases = await renderOriginalPage(
                pdf, n, options.scale,
                options.trimMode,
                options.trimDistance
              );
            }
          } else {
            canvases = await renderOriginalPage(
              pdf, n, options.scale,
              options.trimMode,
              options.trimDistance
            );
          }

          for (const c of canvases) {
            const bytes = await makeOutputPage(
              c,
              options.depth,
              options.algo,
              options.contrast,
              options.brightness
            );

            pages.push(bytes);

            c.width = 1;
            c.height = 1;
          }

          canvases.length = 0;

          const pct =
            ((fi + n / pageTotal) / chosen.length) * 100;

          setStatus(
            '正在转换：' + file.name +
            '\nPDF 第 ' + n + ' / ' + pageTotal +
            ' 页；已生成 ' + pages.length + ' 张 X3 页面。',
            pct
          );

          await yieldUI();
        }

        if (cancelled) {
          pages.length = 0;
          break;
        }

        if (!pages.length) continue;

        const title = safeName(
          file.name.replace(/\.pdf$/i, '')
        );

        const bytes = buildBook(
          pages,
          options.depth === 2,
          title
        );

        pages.length = 0;

        downloadBlob(
          new Blob([bytes], {
            type: 'application/octet-stream'
          }),
          title + (options.depth === 2 ? '.xtch' : '.xtc')
        );

        completed++;

        setStatus(
          '已完成：' + file.name +
          '\n输出 ' + completed + ' 个文件。',
          ((fi + 1) / chosen.length) * 100
        );

      } finally {
        try {
          await pdf?.destroy();
        } catch (_) {}
      }
    }

    if (cancelled) {
      setStatus('已取消。已完成的文件已保留。');
    } else {
      setStatus('全部完成。共生成 ' + completed + ' 个 XTC / XTCH 文件。', 100);
    }

  } catch (e) {
    setStatus('转换失败：' + (e?.message || e));
    console.error(e);
  } finally {
    running = false;
    $('start').disabled = !chosen.length;
    $('pick').disabled = false;
    $('previewBtn').disabled = !chosen.length;
    $('cancel').disabled = true;
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
       }
