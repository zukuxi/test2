// X3 Document PDF Converter — independent document workflow
const W=528,H=792,$=id=>document.getElementById(id);
let chosen=[],cancelled=false,running=false,previewing=false,pdfjsPromise=null,previewTimer=null;

$('pick').onclick=()=>$('pdfs').click();
$('pdfs').addEventListener('change',()=>{
 chosen=Array.from($('pdfs').files||[]);
 $('fileInfo').textContent=chosen.length
  ?'已选择 '+chosen.length+' 个 PDF：\n'+chosen.map(f=>f.name+'（'+(f.size/1048576).toFixed(2)+' MB）').join('\n')
  :'尚未选择 PDF。';
 $('start').disabled=!chosen.length||running;
 $('previewBtn').disabled=!chosen.length||running;
 $('previewGrid').innerHTML='';
 if(chosen.length){$('previewInfo').textContent='正在自动生成第一页预览…';previewFirst();}
 else $('previewInfo').textContent='请选择 PDF 文件。';
});
$('previewBtn').onclick=()=>previewFirst();
['depth','trim','scale','dither','contrast','brightness'].forEach(id=>$(id).addEventListener('change',()=>{
 if(!chosen.length||running)return;
 clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(!previewing)previewFirst();},180);
}));
$('start').onclick=()=>runConversion();
$('cancel').onclick=()=>{cancelled=true;$('cancel').disabled=true;setStatus('正在取消…');};

function setStatus(t,p){
 $('progressText').textContent=t;
 if(p!==undefined)$('bar').style.width=Math.max(0,Math.min(100,p))+'%';
}
function safeName(s){return (s||'document').replace(/[\\/:*?"<>|]/g,'_').trim()||'document';}
function yieldUI(){return new Promise(r=>setTimeout(r,0));}
async function getPdfjs(){
 if(!pdfjsPromise)pdfjsPromise=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/legacy/build/pdf.mjs');
 return pdfjsPromise;
}
async function openPdf(file){
 const pdfjs=await getPdfjs();
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.mjs';
 const data=new Uint8Array(await file.arrayBuffer());
 return await pdfjs.getDocument({
  data,
  disableAutoFetch:true,
  disableStream:true,
  isEvalSupported:false,
  // Many Japanese academic PDFs reference Hiragino fonts without embedding them.
  // Load PDF.js CMaps and standard font data, and allow browser system-font fallback.
  cMapUrl:'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/cmaps/',
  cMapPacked:true,
  standardFontDataUrl:'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/standard_fonts/',
  useSystemFonts:true,
  disableFontFace:false,
  fontExtraProperties:true
 }).promise;
}
async function renderPdfPage(pdf,n,scale){
 const page=await pdf.getPage(n);
 const viewport=page.getViewport({scale});
 const c=document.createElement('canvas');
 c.width=Math.max(1,Math.ceil(viewport.width));c.height=Math.max(1,Math.ceil(viewport.height));
 const ctx=c.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 await page.render({canvasContext:ctx,viewport,background:'rgb(255,255,255)'}).promise;
 page.cleanup();
 // 文档页统一转成横向；PDF 自带的旋转信息由 PDF.js 先处理。
 if(c.width<c.height)return rotateCanvas(c);
 return c;
}
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
function rotateCanvas(src){
 const out=canvas(src.height,src.width),ctx=out.getContext('2d');
 ctx.translate(out.width/2,out.height/2);ctx.rotate(Math.PI/2);
 ctx.drawImage(src,-src.width/2,-src.height/2);
 src.width=1;src.height=1;return out;
}
function cropCanvas(src,x,y,w,h){
 const c=canvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(src,x,y,w,h,0,0,c.width,c.height);return c;
}
// Conservative edge detection: trim only rows/columns that are almost entirely white.
// A 2px safety margin is retained to protect thin rules and edge annotations.
function trimWhite(src,mode){
 if(mode==='off')return src;
 const ctx=src.getContext('2d',{willReadFrequently:true});
 const data=ctx.getImageData(0,0,src.width,src.height).data,w=src.width,h=src.height;
 const strong=mode==='strong',threshold=strong?246:250,whiteRatio=strong?.975:.992;
 const maxX=Math.floor(w*(strong?.28:.20)),maxY=Math.floor(h*(strong?.28:.20));
 const rowWhite=y=>{let n=0,k=0;for(let x=0;x<w;x+=Math.max(1,Math.floor(w/1200))){const i=(y*w+x)*4;const lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];n++;if(lum>=threshold)k++;}return k/Math.max(1,n);};
 const colWhite=x=>{let n=0,k=0;for(let y=0;y<h;y+=Math.max(1,Math.floor(h/1200))){const i=(y*w+x)*4;const lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];n++;if(lum>=threshold)k++;}return k/Math.max(1,n);};
 let top=0,bottom=h-1,left=0,right=w-1;
 while(top<maxY&&rowWhite(top)>whiteRatio)top++;
 while(bottom>h-1-maxY&&rowWhite(bottom)>whiteRatio)bottom--;
 while(left<maxX&&colWhite(left)>whiteRatio)left++;
 while(right>w-1-maxX&&colWhite(right)>whiteRatio)right--;
 const pad=2;top=Math.max(0,top-pad);left=Math.max(0,left-pad);
 bottom=Math.min(h-1,bottom+pad);right=Math.min(w-1,right+pad);
 if(right-left<w*.35||bottom-top<h*.35)return src;
 const out=cropCanvas(src,left,top,right-left+1,bottom-top+1);
 src.width=1;src.height=1;return out;
}
function makeX3Page(src){
 // 整页先转横向后，每个三分之一切片已经是竖向阅读区域。
 // 这里绝不能再次旋转切片，否则文字会横躺并缩成页面中间的一条。
 const out=canvas(W,H),ctx=out.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 const scale=Math.min(W/src.width,H/src.height);
 const dw=src.width*scale,dh=src.height*scale;
 ctx.drawImage(src,(W-dw)/2,(H-dh)/2,dw,dh);
 return out;
}
function splitThree(page,trimMode){
 const trimmed=trimWhite(page,trimMode),w=trimmed.width,h=trimmed.height;
 const cuts=[0,Math.round(w/3),Math.round(w*2/3),w],out=[];
 for(let i=0;i<3;i++){
  const part=cropCanvas(trimmed,cuts[i],0,cuts[i+1]-cuts[i],h);
  out.push(makeX3Page(part));part.width=1;part.height=1;
 }
 trimmed.width=1;trimmed.height=1;
 return out;
}
function canvasToGray(c){
 const d=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data,g=new Uint8Array(W*H);
 for(let i=0,j=0;i<d.length;i+=4,j++)g[j]=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);
 return g;
}


function contrastGray(gray,mode){
 const factors={
  none:1,
  light:1.10,
  medium:1.25,
  strong:1.45,
  maximum:1.70
 };

 const factor=factors[mode]??1;
 if(factor===1)return new Uint8Array(gray);

 const out=new Uint8Array(gray.length);

 for(let i=0;i<gray.length;i++){
  out[i]=Math.max(
   0,
   Math.min(255,Math.round((gray[i]-127.5)*factor+127.5))
  );
 }

 return out;
}

function brightnessGray(gray,brightness){
 const amount=Number(brightness)||0;
 if(amount===0)return new Uint8Array(gray);

 const out=new Uint8Array(gray.length);

 for(let i=0;i<gray.length;i++){
  out[i]=Math.max(0,Math.min(255,gray[i]+amount*2));
 }

 return out;
}

function dither(
 gray,w,h,mode,depth,contrast='none',brightness=0,ditherStrength=100,threshold=128
){
 // 处理顺序：对比度 → 亮度 → 抖动量化。
 const contrasted=contrastGray(gray,contrast);
 const adjusted=brightnessGray(contrasted,brightness);
 const a=new Float32Array(adjusted);
 const matrix=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
 const clamp=v=>Math.max(0,Math.min(255,v));

 const binaryThreshold=Math.max(
  0,Math.min(255,Number(threshold)||128)
 );
 const strength=Math.max(
  0,Math.min(100,Number(ditherStrength)||0)
 )/100;

 const quantize=v=>{
  v=clamp(v);

  if(depth!==2)return v<binaryThreshold?0:255;

  return v<42.5?0:v<127.5?85:v<212.5?170:255;
 };

 for(let y=0;y<h;y++){
  for(let x=0;x<w;x++){
   const i=y*w+x;
   const old=clamp(a[i]);

   if(mode==='ordered'){
    const step=depth===2?85:255;
    const bias=((matrix[y&3][x&3]+0.5)/16-0.5)*step*strength;
    a[i]=quantize(old+bias);
    continue;
   }

   const value=quantize(old);
   a[i]=value;

   if(mode==='none'||strength===0)continue;

   const error=(old-value)*strength;

   const add=(xx,yy,weight,divisor)=>{
    if(xx>=0&&xx<w&&yy<h){
     a[yy*w+xx]+=error*weight/divisor;
    }
   };

   if(mode==='atkinson'){
    add(x+1,y,1,8);
    add(x+2,y,1,8);
    add(x-1,y+1,1,8);
    add(x,y+1,1,8);
    add(x+1,y+1,1,8);
    add(x,y+2,1,8);
   }else if(mode==='sierra-lite'){
    add(x+1,y,2,4);
    add(x-1,y+1,1,4);
    add(x,y+1,1,4);
   }else{
    add(x+1,y,7,16);
    add(x-1,y+1,3,16);
    add(x,y+1,5,16);
    add(x+1,y+1,1,16);
   }
  }
 }

 return Uint8Array.from(a,v=>Math.round(clamp(v)));
}

function packXTG(px,w,h){
 const rb=Math.ceil(w/8),data=new Uint8Array(rb*h);

 for(let y=0;y<h;y++){
  for(let x=0;x<w;x++){
   if(px[y*w+x]>=128){
    data[y*rb+(x>>3)]|=0x80>>(x&7);
   }
  }
 }

 return makePage('XTG\0',w,h,data);
}

function packXTH(px,w,h){
 const cb=Math.ceil(h/8),plane=cb*w;
 const p0=new Uint8Array(plane),p1=new Uint8Array(plane);

 for(let x=0;x<w;x++){
  const off=(w-1-x)*cb;

  for(let y=0;y<h;y++){
   const p=px[y*w+x],v=p>=212?0:p>=127?1:p>=42?2:3;
   const idx=off+(y>>3),bit=7-(y&7);

   if(v&1)p0[idx]|=1<<bit;
   if(v&2)p1[idx]|=1<<bit;
  }
 }

 const data=new Uint8Array(plane*2);
 data.set(p0);
 data.set(p1,plane);

 return makePage('XTH\0',w,h,data);
}

function makePage(magic,w,h,data){
 const out=new Uint8Array(22+data.length),v=new DataView(out.buffer);

 for(let i=0;i<4;i++)out[i]=magic.charCodeAt(i);

 v.setUint16(4,w,true);
 v.setUint16(6,h,true);
 out[8]=0;
 out[9]=0;
 v.setUint32(10,data.length,true);

 out.set(data,22);
 out.set(md5(data).slice(0,8),14);

 return out;
}

function md5(input){
 // 修正 MD5 轮移位表，确保页面校验值计算正确。
 const K=new Uint32Array(64);
 const S=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];

 for(let i=0;i<64;i++){
  K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0;
 }

 const len=input.length,bitLen=len*8;
 const total=((len+9+63)>>6)<<6;
 const msg=new Uint8Array(total);

 msg.set(input);
 msg[len]=128;

 const mdv=new DataView(msg.buffer);
 mdv.setUint32(total-8,bitLen>>>0,true);
 mdv.setUint32(total-4,Math.floor(bitLen/4294967296),true);

 let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;

 for(let o=0;o<total;o+=64){
  const M=new Uint32Array(16),dv=new DataView(msg.buffer,o,64);

  for(let i=0;i<16;i++)M[i]=dv.getUint32(i*4,true);

  let a=a0,b=b0,c=c0,d=d0;

  for(let i=0;i<64;i++){
   let f,g;

   if(i<16){
    f=(b&c)|(~b&d);
    g=i;
   }else if(i<32){
    f=(d&b)|(~d&c);
    g=(5*i+1)%16;
   }else if(i<48){
    f=b^c^d;
    g=(3*i+5)%16;
   }else{
    f=c^(b|~d);
    g=(7*i)%16;
   }

   const s=i<16?S[i%4]:i<32?S[4+i%4]:i<48?S[8+i%4]:S[12+i%4];
   const z=(a+f+K[i]+M[g])|0;
   const r=(z<<s)|(z>>>(32-s));

   a=d;
   d=c;
   c=b;
   b=(b+r)|0;
  }

  a0=(a0+a)|0;
  b0=(b0+b)|0;
  c0=(c0+c)|0;
  d0=(d0+d)|0;
 }

 const out=new Uint8Array(16),dv=new DataView(out.buffer);
 [a0,b0,c0,d0].forEach((v,i)=>dv.setUint32(i*4,v,true));

 return out;
}

function buildBook(pages,is2,title){
 if(pages.length>65535){
  throw new Error('页面数量超过 XTC 容器可表示的上限（65535 页）。');
 }

 const metaOff=56,indexOff=312,dataOff=indexOff+pages.length*16;
 const total=dataOff+pages.reduce((n,p)=>n+p.length,0);
 const out=new Uint8Array(total),v=new DataView(out.buffer);
 const magic=is2?'XTCH':'XTC\0';

 for(let i=0;i<4;i++)out[i]=magic.charCodeAt(i);

 v.setUint16(4,1,true);
 v.setUint16(6,pages.length,true);
 v.setUint32(8,0x01000100,true);
 v.setUint32(12,1,true);
 v.setBigUint64(16,BigInt(metaOff),true);
 v.setBigUint64(24,BigInt(indexOff),true);
 v.setBigUint64(32,BigInt(dataOff),true);
 v.setBigUint64(40,0n,true);
 v.setBigUint64(48,0n,true);

 out.set(new TextEncoder().encode(title).slice(0,127),metaOff);

 let pos=dataOff;

 pages.forEach((p,i)=>{
  const e=indexOff+i*16;
  v.setBigUint64(e,BigInt(pos),true);
  v.setUint32(e+8,p.length,true);
  v.setUint16(e+12,W,true);
  v.setUint16(e+14,H,true);
  out.set(p,pos);
  pos+=p.length;
 });

 return out;
}

async function previewFirst(){
 if(!chosen.length||previewing||running)return;
 previewing=true;$('previewBtn').disabled=true;$('previewInfo').textContent='正在渲染并裁切第一页…';
 $('previewGrid').innerHTML='';
 let pdf;
 try{
  pdf=await openPdf(chosen[0]);
  const page=await renderPdfPage(pdf,1,Number($('scale').value));
  const pieces=splitThree(page,$('trim').value);page.width=1;page.height=1;
  pieces.forEach((p,i)=>{
   const box=document.createElement('div');box.className='preview-card';
   const label=document.createElement('div');label.textContent=['① 左侧','② 中间','③ 右侧'][i];
   const img=document.createElement('img');img.alt=label.textContent;img.src=p.toDataURL('image/png');
   box.append(label,img);$('previewGrid').append(box);p.width=1;p.height=1;
  });
  $('previewInfo').textContent='第一页预览完成。正式转换会使用相同的白边裁切和三等分方式。';
 }catch(e){$('previewInfo').textContent='预览失败：'+(e?.message||e);}
 finally{try{await pdf?.destroy();}catch(_){}previewing=false;$('previewBtn').disabled=running||!chosen.length;}
}
async function runConversion(){
 if(running||!chosen.length)return;
 running=true;cancelled=false;$('start').disabled=true;$('pick').disabled=true;$('previewBtn').disabled=true;$('cancel').disabled=false;
 const depth=Number($('depth').value),algo=$('dither').value,contrast=$('contrast').value;
 const brightness=Number($('brightness').value),trimMode=$('trim').value,scale=Number($('scale').value);
 let completed=0;
 try{
  for(let fi=0;fi<chosen.length;fi++){
   if(cancelled)break;
   const file=chosen[fi],pdf=await openPdf(file),pages=[];
   const pageTotal=pdf.numPages;
   if(pageTotal*3>65535)throw new Error(file.name+' 页数过多：三等分后超过 XTC 的 65535 页上限。');
   for(let n=1;n<=pageTotal;n++){
    if(cancelled)break;
    let page=null,pieces=[];
    try{
     page=await renderPdfPage(pdf,n,scale);
     pieces=splitThree(page,trimMode);page.width=1;page.height=1;
     for(const p of pieces){
      const gray=canvasToGray(p);
      const processed=dither(gray,W,H,algo,depth,contrast,brightness,100,128);
      pages.push(depth===2?packXTH(processed,W,H):packXTG(processed,W,H));
      p.width=1;p.height=1;
     }
    }finally{
     if(page){page.width=1;page.height=1;}
     pieces.forEach(p=>{p.width=1;p.height=1;});
    }
    completed++;
    const pct=((fi+(n/pageTotal))/chosen.length)*100;
    setStatus('正在转换：'+file.name+'\nPDF 第 '+n+' / '+pageTotal+' 页；已生成 '+pages.length+' 张 X3 页面。',pct);
    await yieldUI();
   }
   try{await pdf.destroy();}catch(_){}
   if(cancelled){pages.length=0;break;}
   if(!pages.length)continue;
   const title=safeName(file.name.replace(/\.pdf$/i,''));
   const bytes=buildBook(pages,depth===2,title);
   pages.length=0;
   downloadBlob(new Blob([bytes],{type:'application/octet-stream'}),title+(depth===2?'.xtch':'.xtc'));
   setStatus('已完成：'+file.name+'\n输出 '+pageTotal*3+' 页。',((fi+1)/chosen.length)*100);
   await yieldUI();
  }
  if(cancelled)setStatus('已取消。已完成的 PDF 文件已保留，当前文件未输出。');
  else setStatus('全部完成。共处理 '+completed+' 张 PDF 原始页面；每页转换为 3 张 X3 页面。',100);
 }catch(e){setStatus('转换失败：'+(e?.message||e));console.error(e);}
 finally{
  running=false;$('start').disabled=!chosen.length;$('pick').disabled=false;$('previewBtn').disabled=!chosen.length;$('cancel').disabled=true;
 }
}
function downloadBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
