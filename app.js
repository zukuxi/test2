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
let previewPending = false;
let previewRevision = 0;

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
  'convertMode', 'orientation', 'textScale'
].forEach(id => {
  const el = $(id);
  if (!el) return;

  const schedulePreview = () => {
    updateOrientation();
    if (!chosen.length || running) return;
    // 先让正在生成的旧预览失效；不要等防抖结束才标记，
    // 否则快速拖动参数时旧结果可能先显示出来。
    previewRevision++;
    if (previewing) previewPending = true;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (!previewing) previewFirst();
    }, 220);
  };
  el.addEventListener('input', schedulePreview);
  el.addEventListener('change', schedulePreview);
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

  // 在理论三等分线附近寻找墨迹最少的列，避免切线穿过整行文字。
  // 搜索范围受相邻分段宽度约束，仍保持三段顺序和完整页面覆盖。
  function findQuietCut(target, minX, maxX) {
    const radius = Math.max(8, Math.round(w * 0.045));
    const from = Math.max(minX, target - radius);
    const to = Math.min(maxX, target + radius);
    const data = trimmed.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, w, h).data;
    let bestX = target, bestScore = Infinity;
    const stride = Math.max(1, Math.floor(h / 700));
    for (let x = from; x <= to; x++) {
      let ink = 0;
      for (let y = 0; y < h; y += stride) {
        const i = (y * w + x) * 4;
        const gray = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        if (gray < 220) ink += (220 - gray) / 220;
      }
      // 微弱惩罚偏离理论切线，避免切到过窄的空白边缘。
      const score = ink + Math.abs(x - target) * 0.025;
      if (score < bestScore) { bestScore = score; bestX = x; }
    }
    return bestX;
  }
  const ideal1 = Math.round(w / 3), ideal2 = Math.round(w * 2 / 3);
  const minPart = Math.round(w * 0.27);
  const cut1 = findQuietCut(ideal1, minPart, w - minPart * 2);
  const cut2 = findQuietCut(ideal2, cut1 + minPart, w - minPart);
  const cuts = [0, cut1, cut2, w];

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
async function renderGraphicsLayer(page, viewport, pdfjs) {
  // 只把 PDF 中真正嵌入的位图对象作为图片候选。
  // 不再把所有非文字绘图指令都当成图片：部分 PDF（尤其日文 PDF）
  // 会用路径/Type3 字形绘制正文，旧逻辑会把整段正文误判成图片。
  const opList = await page.getOperatorList({ intent: 'display' });
  const imageOps = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintJpegXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintSolidColorImageMask,
    pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintImageMaskXObjectRepeat
  ].filter(v => v !== undefined));
  if (!imageOps.size || !opList.fnArray.some(op => imageOps.has(op))) return null;

  const layer = canvas(viewport.width, viewport.height);
  const ctx = layer.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, layer.width, layer.height);
  await page.render({
    canvasContext: ctx,
    viewport,
    intent: 'display',
    background: 'rgb(255,255,255)',
    operationsFilter(index) {
      return imageOps.has(opList.fnArray[index]);
    }
  }).promise;
  return layer;
}

function findGraphicRegions(layer) {
  if (!layer) return [];
  const { width: w, height: h } = layer;
  const data = layer.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, w, h).data;
  const row = new Uint8Array(h);
  const left = new Int32Array(h).fill(w);
  const right = new Int32Array(h).fill(-1);

  // Text operators are filtered out, so the remaining dark pixels represent
  // placed images, diagrams, rules and vector artwork.
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const gray = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (gray < 218) {
        count++;
        if (x < left[y]) left[y] = x;
        if (x > right[y]) right[y] = x;
      }
    }
    if (count >= 2) row[y] = 1;
  }

  const bands = [];
  let band = null;
  for (let y = 0; y < h; y++) {
    if (row[y]) {
      if (!band) band = { x: left[y], y0: y, x2: right[y], y2: y, last: y };
      else if (y - band.last <= 22) {
        band.x = Math.min(band.x, left[y]);
        band.x2 = Math.max(band.x2, right[y]);
        band.y2 = y;
        band.last = y;
      } else {
        bands.push(band);
        band = { x: left[y], y0: y, x2: right[y], y2: y, last: y };
      }
    }
  }
  if (band) bands.push(band);

  // Merge nearby bands when their horizontal extents overlap: table borders
  // and cell rules often form several separated horizontal strokes.
  const merged = [];
  for (const b of bands) {
    const prev = merged[merged.length - 1];
    const overlap = prev && Math.min(prev.x2, b.x2) - Math.max(prev.x, b.x) >
      Math.min(prev.x2 - prev.x, b.x2 - b.x) * 0.35;
    if (prev && b.y0 - prev.y2 <= 30 && overlap) {
      prev.x = Math.min(prev.x, b.x);
      prev.x2 = Math.max(prev.x2, b.x2);
      prev.y2 = b.y2;
    } else merged.push({ ...b });
  }

  return merged.map(b => ({
    x: Math.max(0, b.x - 5), y: Math.max(0, b.y0 - 5),
    w: Math.min(w - b.x + 5, b.x2 - b.x + 11),
    h: Math.min(h - b.y0 + 5, b.y2 - b.y0 + 11)
  })).filter(r => {
    if (r.w < 18 || r.h < 12 || r.w * r.h < 450) return false;
    // 页脚/页眉的单条横线不是图表，避免每页都生成无意义图片块。
    const fullWidthRule = r.w > w * 0.72 && r.h < 8;
    const nearPageEdge = r.y < h * 0.06 || r.y > h * 0.88;
    return !(fullWidthRule && nearPageEdge);
  });
}

async function renderFullPageRaster(page, viewport) {
  const full = canvas(viewport.width, viewport.height);
  const ctx = full.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, full.width, full.height);
  await page.render({
    canvasContext: ctx,
    viewport,
    intent: 'display',
    background: 'rgb(255,255,255)'
  }).promise;
  return full;
}

function mergeAndExpandGraphicRegions(regions, width, height) {
  // 将同一张表格/公式图形中被横线分开的检测带合并，并留出足够边距，
  // 让紧贴图形的公式文字和表格单元格文字进入同一张局部图片。
  const sorted = regions.map(r => ({ ...r })).sort((a,b) => a.y - b.y);
  const merged = [];
  for (const r of sorted) {
    const prev = merged[merged.length - 1];
    const xOverlap = prev && Math.min(prev.x + prev.w, r.x + r.w) -
      Math.max(prev.x, r.x);
    const ratio = prev ? xOverlap / Math.max(1, Math.min(prev.w, r.w)) : 0;
    if (prev && r.y - (prev.y + prev.h) <= 34 && ratio > 0.25) {
      const x = Math.min(prev.x, r.x), y = Math.min(prev.y, r.y);
      const right = Math.max(prev.x + prev.w, r.x + r.w);
      const bottom = Math.max(prev.y + prev.h, r.y + r.h);
      Object.assign(prev, { x, y, w: right - x, h: bottom - y });
    } else merged.push(r);
  }
  return merged.map(r => {
    const padX = Math.max(24, Math.round(width * 0.025));
    // 公式分数线附近的分子/分母往往是文字对象，必须一并收入图片。
    const padY = Math.max(34, Math.round(height * 0.025));
    const x = Math.max(0, r.x - padX);
    const y = Math.max(0, r.y - padY);
    const right = Math.min(width, r.x + r.w + padX);
    const bottom = Math.min(height, r.y + r.h + padY);
    return { x, y, w: right - x, h: bottom - y };
  });
}

function detectTextGraphicRegions(items, viewport, scale) {
  const boxes = (items || []).filter(it => it.str && it.str.trim()).map(it => {
    const t = it.transform || [];
    const size = Math.max(6, Math.hypot(t[2] || 0, t[3] || 0) * scale);
    return {
      text: it.str, x: (t[4] || 0) * scale,
      y: viewport.height - (t[5] || 0) * scale,
      w: Math.max(1, (it.width || size * it.str.length * .5) * scale),
      h: Math.max(size, (it.height || size) * scale), size
    };
  }).sort((a,b) => a.y-b.y || a.x-b.x);
  const rows = [];
  for (const b of boxes) {
    let row = rows.find(r => Math.abs(r.y-b.y) <= Math.max(3, Math.min(r.size,b.size)*.38));
    if (!row) rows.push(row={y:b.y,size:b.size,items:[]});
    row.items.push(b); row.y=row.items.reduce((v,x)=>v+x.y,0)/row.items.length;
    row.size=Math.max(row.size,b.size);
  }
  rows.sort((a,b)=>a.y-b.y);
  const regions=[];
  // 表格：至少 4 行、每行多个独立单元格，且列起点在行间重复对齐。
  let run=[];
  const flush=()=>{
    if (run.length>=4) {
      const starts=[];
      for (const r of run) for (const b of r.items) starts.push(b.x);
      const clusters=[];
      starts.sort((a,b)=>a-b).forEach(x=>{
        let c=clusters.find(v=>Math.abs(v.mean-x)<14);
        if(!c)clusters.push(c={mean:x,n:0});
        c.mean=(c.mean*c.n+x)/(++c.n);
      });
      const aligned=clusters.filter(c=>c.n>=Math.max(3,Math.floor(run.length*.35)));
      const avg=run.reduce((n,r)=>n+r.items.length,0)/run.length;
      const numeric=run.reduce((n,r)=>n+r.items.filter(b=>/[0-9０-９%％]/.test(b.text)).length,0)/
        Math.max(1,run.reduce((n,r)=>n+r.items.length,0));
      const numericRows = run.filter(r =>
        r.items.filter(b => /[0-9０-９%％]/.test(b.text)).length >= 2
      ).length;
      // 正文行即使被 PDF 拆成多个文字对象，也不应自动变成图片。
      // 表格必须同时具备重复列对齐、足够多的数值单元格行和多列结构。
      if(avg>=3.2 && aligned.length>=3 && numeric>.28 &&
         numericRows>=Math.max(3, Math.ceil(run.length*.45))) {
        const all=run.flatMap(r=>r.items);
        const x=Math.max(0,Math.min(...all.map(b=>b.x))-12);
        const y=Math.max(0,Math.min(...all.map(b=>b.y))-12);
        const right=Math.min(viewport.width,Math.max(...all.map(b=>b.x+b.w))+18);
        const bottom=Math.min(viewport.height,Math.max(...all.map(b=>b.y+b.h))+14);
        regions.push({x,y,w:right-x,h:bottom-y});
      }
    }
    run=[];
  };
  for(const r of rows){
    const multi=r.items.length>=3;
    const prev=run[run.length-1];
    const gap=prev?r.y-prev.y:0;
    if(multi && (!prev || gap<=Math.max(24,r.size*2.2))) run.push(r);
    else { flush(); if(multi) run.push(r); }
  }
  flush();
  // 数学公式：含运算符/关系符的独立行作为整体图片，边界随后再扩展。
  for(const r of rows){
    const text=r.items.map(b=>b.text).join('');
    if(/[=≤≥≠≈±×÷√∑∫<>/·]/.test(text) && /[0-9A-Za-z]/.test(text) && text.length>=4){
      const all=r.items;
      const x=Math.max(0,Math.min(...all.map(b=>b.x))-18);
      const y=Math.max(0,r.y-r.size*1.8);
      const right=Math.min(viewport.width,Math.max(...all.map(b=>b.x+b.w))+24);
      const bottom=Math.min(viewport.height,r.y+Math.max(...all.map(b=>b.h))+r.size*1.8);
      regions.push({x,y,w:right-x,h:bottom-y});
    }
  }
  return regions;
}

function normalizeBulletText(text) {
  // 部分 PDF 字体的项目符号 ToUnicode 映射错误，会被提取成方框/叉号。
  // 仅在行首且后面存在正文时纠正，避免改动正文中的方框符号。
  return String(text || '').replace(/^([\s　]*)(?:\u25a0|\u25a1|\u25aa|\u25ab|\u2610|\u2612|\u2715|\u2716|\u00d7|\uf0b7|\uf0a7|\ufffd)(?=\s*\S)/u, '$1•');
}

async function renderReflowPages(pdf, n, scale, textScale = 1) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });
  const pdfjs = await getPdfjs();
  const textContent = await page.getTextContent({
    includeMarkedContent: true,
    disableCombineTextItems: true
  });
  const sourceItems = (textContent.items || []).filter(item => item.str && item.str.trim());
  const items = sourceItems;
  if (!items.length) { page.cleanup(); return null; }

  let graphicLayer = null;
  let fullPageRaster = null;
  let graphicRegions = [];
  try {
    // 图形层只负责定位图表/线条/插图；真正裁图使用完整页面栅格，
    // 因此公式中的文字、表格单元格文字也会一起保留在图片块里。
    graphicLayer = await renderGraphicsLayer(page, viewport, pdfjs);
    graphicRegions = findGraphicRegions(graphicLayer);
    graphicRegions.push(...detectTextGraphicRegions(sourceItems, viewport, scale));
    if (graphicRegions.length) {
      fullPageRaster = await renderFullPageRaster(page, viewport);
      graphicRegions = mergeAndExpandGraphicRegions(
        graphicRegions, viewport.width, viewport.height
      );
    }
  } catch (e) {
    // 图形层识别失败时仍继续文字重排，不因单个图形对象而整页退回。
    // 失败原因写入控制台，便于定位个别 PDF 的特殊绘制指令。
    console.warn('X3 图形区域识别失败，继续文字重排：', e);
    graphicLayer?.width && (graphicLayer.width = 1);
    graphicLayer?.height && (graphicLayer.height = 1);
    graphicLayer = null;
    graphicRegions = [];
  }

  const textBlocks = [];
  const sorted = items.map(item => {
    const tx = item.transform || [];
    const fontSize = Math.max(7, Math.hypot(tx[2] || 0, tx[3] || 0) * scale);
    const x = (tx[4] || 0) * scale;
    const y = viewport.height - (tx[5] || 0) * scale;
    const w = Math.max(1, (item.width || fontSize * (item.str || '').length * 0.5) * scale);
    const h = Math.max(fontSize, (item.height || fontSize) * scale);
    return { text: item.str, x, y, w, h, size: fontSize, hasEOL: !!item.hasEOL };
  }).sort((a,b) => a.y - b.y || a.x - b.x);

  // Adaptive Japanese/CJK line grouping: baseline tolerance scales with font
  // height, but never expands so far that adjacent printed lines collapse.
  const lines = [];
  for (const it of sorted) {
    let best = null, bestDelta = Infinity;
    for (const line of lines) {
      const tolerance = Math.max(3.2, Math.min(10, Math.min(line.size, it.size) * 0.42));
      const delta = Math.abs(line.y - it.y);
      if (delta <= tolerance && delta < bestDelta) { best = line; bestDelta = delta; }
    }
    if (!best) {
      best = { y: it.y, size: it.size, items: [] };
      lines.push(best);
    }
    best.items.push(it);
    best.size = Math.max(best.size, it.size);
    best.y = best.items.reduce((sum, v) => sum + v.y, 0) / best.items.length;
  }
  lines.sort((a,b) => a.y - b.y);
  const splitLines = [];
  for (const line of lines) {
    line.items.sort((a,b) => a.x - b.x);
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      const x = Math.min(...segment.map(v => v.x));
      splitLines.push({
        y: line.y,
        text: segment.map(v => v.text).join(''),
        size: Math.max(...segment.map(v => v.size)),
        x,
        w: Math.max(...segment.map(v => v.x + v.w)) - x,
        h: Math.max(...segment.map(v => v.h)),
        end: segment.some(v => v.hasEOL)
      });
      segment = [];
    };
    for (const item of line.items) {
      const prev = segment[segment.length - 1];
      const gap = prev ? item.x - (prev.x + prev.w) : 0;
      // A large horizontal gap usually marks a separate column or text block,
      // not a Japanese continuation of the same printed line.
      if (prev && gap > Math.max(18, Math.min(prev.size, item.size) * 2.2)) flush();
      segment.push(item);
    }
    flush();
  }

  // 先从普通文字流中移除图表/公式图片区域，再把相邻的日文原始行
  // 合并成段落。日文 PDF 常把一个自然段拆成很多短行，不能逐行强制换段。
  const plainLines = [];
  for (const line of splitLines) {
    const overlapsGraphic = graphicRegions.some(r => {
      const ix = Math.max(0, Math.min(line.x + line.w, r.x + r.w) - Math.max(line.x, r.x));
      const iy = Math.max(0, Math.min(line.y + line.h, r.y + r.h) - Math.max(line.y, r.y));
      return ix * iy > Math.min(line.w * line.h, r.w * r.h) * 0.12;
    });
    if (!overlapsGraphic && line.text.trim()) plainLines.push(line);
  }

  const paragraphs = [];
  for (const line of plainLines) {
    const prev = paragraphs[paragraphs.length - 1];
    const gap = prev ? line.y - prev.lastY : Infinity;
    const close = prev && gap <= Math.max(14, Math.min(prev.size, line.size) * 2.15) &&
      Math.abs(line.x - prev.x) <= Math.max(30, PAGE_W * 0.12);
    if (close) {
      const left = prev.text.slice(-1);
      const right = line.text.slice(0, 1);
      const needsSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
      prev.text += (needsSpace ? ' ' : '') + line.text;
      prev.lastY = line.y;
      prev.size = Math.max(prev.size, line.size);
    } else {
      paragraphs.push({ y: line.y, lastY: line.y, x: line.x, text: line.text, size: line.size });
    }
  }

  // 图片块与文字段落按 PDF 原始纵向位置交错插入。
  const blocks = paragraphs.map(p => ({
    type: 'text', y: p.y, text: p.text, size: p.size
  }));
  for (const r of graphicRegions) blocks.push({ type: 'image', y: r.y, rect: r });
  blocks.sort((a,b) => a.y - b.y || (a.type === 'image' ? -1 : 1));

  const pages = [];
  let current = canvas(PAGE_W, PAGE_H);
  let ctx = current.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  let y = 28;
  const margin = 28;
  const usableWidth = PAGE_W - margin * 2;
  const sourceScale = PAGE_H / Math.max(1, viewport.height);

  function nextPage() {
    pages.push(current);
    current = canvas(PAGE_W, PAGE_H);
    ctx = current.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    y = 28;
  }
  function writeText(text, size) {
    const fontSize = Math.max(8, Math.min(30, size * 0.82 * textScale));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = '#111';
    const chars = Array.from(text);
    let buf = '';
    for (const ch of chars) {
      if (buf && ctx.measureText(buf + ch).width > usableWidth) {
        if (y + fontSize * 1.6 > PAGE_H - margin) nextPage();
        ctx.fillText(buf, margin, y + fontSize);
        y += fontSize * 1.42;
        buf = ch;
      } else buf += ch;
    }
    if (buf) {
      if (y + fontSize * 1.6 > PAGE_H - margin) nextPage();
      ctx.fillText(buf, margin, y + fontSize);
      y += fontSize * 1.42;
    }
  }

  for (const block of blocks) {
    if (block.type === 'text') {
      writeText(block.text, block.size);
      continue;
    }
    const r = block.rect;
    const image = canvas(r.w, r.h);
    const cropSource = fullPageRaster || graphicLayer;
    image.getContext('2d').drawImage(cropSource, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const ratio = Math.min(usableWidth / r.w, (PAGE_H - margin * 2) / r.h, 1.8);
    const dw = Math.max(1, r.w * ratio), dh = Math.max(1, r.h * ratio);
    if (y + dh + 8 > PAGE_H - margin) nextPage();
    ctx.drawImage(image, margin, y, dw, dh);
    y += dh + 10;
    image.width = 1; image.height = 1;
  }

  if (y > 28 || !pages.length) pages.push(current);
  if (graphicLayer) { graphicLayer.width = 1; graphicLayer.height = 1; }
  if (fullPageRaster) { fullPageRaster.width = 1; fullPageRaster.height = 1; }
  page.cleanup();
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

async function createPagesForPdf(pdf, options, limit = Infinity, preserveCanvases = false) {
  const output = [];
  const pageTotal = pdf.numPages;

  for (let n = 1; n <= pageTotal; n++) {
    if (cancelled || output.length >= limit) break;

    let canvases = [];

    if (options.mode === 'reflow') {
      canvases = await renderReflowPages(pdf, n, options.scale, options.textScale);

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

      // 正式转换在编码后立即释放画布；预览必须保留画布，
      // 因为后续要从它生成灰阶预览图，不能提前缩成 1×1。
      if (!preserveCanvases) {
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
    textScale: Number($('textScale')?.value || 1),
    algo: $('dither').value,
    contrast: $('contrast').value,
    brightness: Number($('brightness').value)
  };
}

async function previewFirst() {
  if (!chosen.length || running) return;
  if (previewing) { previewPending = true; return; }

  previewing = true;
  previewPending = false;
  const thisRevision = previewRevision;
  $('previewBtn').disabled = true;
  $('previewGrid').innerHTML = '';
  $('previewInfo').textContent = '正在生成前 10 张最终输出页面…';

  let pdf;

  try {
    const options = getOptions();
    pdf = await openPdf(chosen[0]);

    const pages = await createPagesForPdf(pdf, options, 10, true);
    if (thisRevision !== previewRevision || previewPending) {
      pages.forEach(p => { p.canvas.width = 1; p.canvas.height = 1; });
      return;
    }

    // 预览直接显示实际输出灰阶，而不是未处理的原始彩色/灰度画布。
    // 所以抖动、对比度、亮度和 1-bit/2-bit 深度都会立即反映到预览。
    for (const pageItem of pages) {
      const c = pageItem.canvas;
      const gray = canvasToGray(c);
      const processed = dither(
        gray, c.width, c.height,
        options.algo, options.depth,
        options.contrast, options.brightness, 100, 128
      );
      const ctx = c.getContext('2d');
      const imageData = ctx.createImageData(c.width, c.height);
      for (let p = 0, q = 0; p < processed.length; p++, q += 4) {
        const v = processed[p];
        imageData.data[q] = v;
        imageData.data[q + 1] = v;
        imageData.data[q + 2] = v;
        imageData.data[q + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    }

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
    if (previewPending && !running && chosen.length) {
      previewPending = false;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => previewFirst(), 0);
    }
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
            canvases = await renderReflowPages(pdf, n, options.scale, options.textScale);

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
