'use strict';
// On-demand only; no persistent monitoring of webpages.
if (!globalThis.__vfeMhtmlListenerAdded) {
  globalThis.__vfeMhtmlListenerAdded = true;
  browser.runtime.onMessage.addListener(message => {
    if (message?.type === 'CAPTURE_MHTML_PAGE') return captureMhtmlPage();
  });
}
async function captureMhtmlPage() {
  const mainUrl = location.href;
  if (!/^https?:$/.test(location.protocol)) throw new Error('Only HTTP(S) pages are supported.');
  const clone = document.documentElement.cloneNode(true);
  const sourceEls = [...document.documentElement.querySelectorAll('*')];
  const clonedEls = [...clone.querySelectorAll('*')];
  // Capture form state and canvas pixels when available.
  for (let i = 0; i < sourceEls.length && i < clonedEls.length; i++) {
    const src = sourceEls[i], dest = clonedEls[i];
    if (src instanceof HTMLInputElement) {
      if (['checkbox','radio'].includes(src.type)) {
        if (src.checked) dest.setAttribute('checked',''); else dest.removeAttribute('checked');
      } else if (src.type !== 'file' && src.type !== 'password') dest.setAttribute('value',src.value);
    } else if (src instanceof HTMLTextAreaElement) dest.textContent=src.value;
    else if (src instanceof HTMLSelectElement) {
      [...dest.options].forEach((option,j) => { if(src.options[j]?.selected) option.setAttribute('selected',''); else option.removeAttribute('selected'); });
    } else if (src instanceof HTMLCanvasElement) {
      try { let img=document.createElement('img'); img.setAttribute('src',src.toDataURL('image/png')); img.setAttribute('width',String(src.width)); img.setAttribute('height',String(src.height)); dest.replaceWith(img); } catch (_) {}
    }
  }
  // Avoid executing scripts and applying online CSP when archive is opened.
  clone.querySelectorAll('script,meta[http-equiv="Content-Security-Policy"],base').forEach(el => el.remove());
  const resources = new Map(); let failed=0;
  const abs = (raw, base=mainUrl) => { try { const u = new URL(raw,base); return /^https?:$/.test(u.protocol) ? u.href.split('#')[0] : null; } catch (_) { return null; } };
  const pending = new Set();
  function queue(raw,base=mainUrl) { const url=abs(raw,base); if(url && url !== mainUrl) pending.add(url); return url; }
  for (const node of clone.querySelectorAll('[src],[poster],[href],[srcset]')) {
    for (const attr of ['src','poster','href']) {
      if (!node.hasAttribute(attr)) continue;
      const raw=node.getAttribute(attr); if(!raw || raw.startsWith('#')) continue;
      const url=abs(raw);
      if(url) {
        node.setAttribute(attr,url);
        if(attr!=='href' || node.matches('link[rel~="stylesheet"],link[rel~="icon"]')) queue(url);
      }
    }
    if(node.hasAttribute('srcset')) {
      // srcset is removed: ensure src is the chosen responsive image instead.
      if (node instanceof HTMLImageElement || node.tagName.toLowerCase()==='source') {
        const srcNode=sourceEls[clonedEls.indexOf(node)];
        const selected=srcNode?.currentSrc;
        if(selected) { const url=abs(selected); if(url) {node.setAttribute('src',url); queue(url);} }
      }
      node.removeAttribute('srcset');
    }
  }
  for(const node of clone.querySelectorAll('[style]')) {
    node.setAttribute('style', rewriteCss(node.getAttribute('style'),mainUrl));
  }
  for(const node of clone.querySelectorAll('style')) node.textContent=rewriteCss(node.textContent,mainUrl);
  function rewriteCss(css,base) {
    return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,(all,q,path)=>{
      const url=queue(path,base); return url ? `url("${url.replace(/"/g,'%22')}")` : all;
    }).replace(/@import\s+(['"])([^'"]+)\1/gi,(all,q,path)=>{const url=queue(path,base);return url?`@import "${url}"`:all;});
  }
  // Inline currently used CSS for basic layout and dynamic styles, while retaining stylesheets.
  // Some browser-managed and cross-origin content is not readable by WebExtensions.
  const MAX_RESOURCES=250, MAX_BYTES=40*1024*1024;
  let bytes=0;
  async function fetchResource(url) {
    try {
      const response=await fetch(url,{credentials:'include',cache:'force-cache'});
      if(!response.ok) throw Error('HTTP '+response.status);
      const data=await response.arrayBuffer();
      if(bytes+data.byteLength>MAX_BYTES) throw Error('Size limit');
      bytes+=data.byteLength;
      const mime=response.headers.get('content-type')?.split(';')[0]?.trim() || guessMime(url);
      let content=new Uint8Array(data);
      if(/text\/css/i.test(mime) || /\.css(?:\?|$)/i.test(url)) {
        const css=new TextDecoder().decode(content);
        content=new TextEncoder().encode(rewriteCss(css,url));
      }
      resources.set(url,{url,mime,data:toBase64(content)});
    } catch(_) {failed++;}
  }
  // Process newly-discovered CSS dependencies in additional rounds.
  const visited=new Set();
  while (pending.size && visited.size<MAX_RESOURCES) {
    const batch=[...pending].filter(url=>!visited.has(url)).slice(0,Math.min(12,MAX_RESOURCES-visited.size));
    if(!batch.length) break;
    batch.forEach(url=>{visited.add(url);pending.delete(url);});
    await Promise.all(batch.map(fetchResource));
  }
  if(pending.size) failed+=pending.size;
  const html='<!DOCTYPE html>\n'+clone.outerHTML;
  return {url:mainUrl,title:document.title || 'Untitled',html,resources:[...resources.values()],failed};
}
function toBase64(bytes) {
  let parts=[]; for(let i=0;i<bytes.length;i+=0x6000) parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+0x6000)));
  return btoa(parts.join(''));
}
function guessMime(url) {
  const ext=url.split('?')[0].split('.').pop()?.toLowerCase();
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp',css:'text/css',woff:'font/woff',woff2:'font/woff2',ico:'image/x-icon'})[ext]||'application/octet-stream';
}
