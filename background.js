'use strict';
const urlsByDownload = new Map();
browser.downloads.onErased.addListener(id => { const url = urlsByDownload.get(id); if (url) { URL.revokeObjectURL(url); urlsByDownload.delete(id); } });
browser.downloads.onChanged.addListener(delta => {
  if (!delta.state || !['complete','interrupted'].includes(delta.state.current)) return;
  const url=urlsByDownload.get(delta.id);
  if (url) { URL.revokeObjectURL(url); urlsByDownload.delete(delta.id); }
});
browser.runtime.onMessage.addListener(message => {
  if(message?.type === 'SAVE_CURRENT_TAB') return saveCurrentTab();
});
async function saveCurrentTab() {
  try {
    const [tab]=await browser.tabs.query({active:true,currentWindow:true});
    if (!tab || !/^https?:\/\//i.test(tab.url||'')) throw new Error('Open an HTTP(S) web page first.');
    // User interaction with popup grants activeTab permission.
    await browser.tabs.executeScript(tab.id,{file:'capture.js',runAt:'document_idle'});
    const captured=await browser.tabs.sendMessage(tab.id,{type:'CAPTURE_MHTML_PAGE'});
    if (!captured?.html) throw new Error('No page content was captured.');
    const data=makeMhtml(captured);
    const blob=new Blob([data],{type:'multipart/related'});
    const objectUrl=URL.createObjectURL(blob);
    const filename=safeFilename(captured.title);
    try {
      const id=await browser.downloads.download({url:objectUrl,filename,saveAs:true,conflictAction:'uniquify'});
      urlsByDownload.set(id,objectUrl);
    } catch(error) {URL.revokeObjectURL(objectUrl);throw error;}
    return {ok:true,resources:captured.resources.length,failed:captured.failed};
  } catch(error) {return {ok:false,error:error?.message||String(error)};}
}
function safeFilename(title) {
  const clean=(title||'Untitled').replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g,'_').replace(/[.\s]+$/g,'').trim().slice(0,110)||'Untitled';
  const timestamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z').replace('T','_');
  return `${clean}_${timestamp}.mhtml`;
}
function foldBase64(b64) {return b64.match(/.{1,76}/g)?.join('\r\n')||'';}
function headerSafe(value){return String(value).replace(/[\r\n\x00-\x1F]/g,' ').slice(0,1500);}
function makeMhtml(page) {
  const boundary='----=_VFE_MHTML_'+crypto.randomUUID().replaceAll('-','');
  const parts=[];
  function addPart(mime, location, base64) {
    parts.push(`--${boundary}\r\nContent-Type: ${headerSafe(mime)}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${headerSafe(location)}\r\n\r\n${foldBase64(base64)}\r\n`);
  }
  const htmlBytes=new TextEncoder().encode(page.html);
  let binary=''; for(let i=0;i<htmlBytes.length;i+=0x6000) binary+=String.fromCharCode(...htmlBytes.subarray(i,i+0x6000));
  addPart('text/html; charset=utf-8',page.url,btoa(binary));
  for(const r of page.resources) addPart(r.mime,r.url,r.data);
  return `From: <Saved by VFE MHTML Firefox>\r\nSubject: ${headerSafe(page.title)}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; type="text/html"; boundary="${boundary}"\r\n\r\nThis is a MIME encapsulated web archive.\r\n`+parts.join('')+`--${boundary}--\r\n`;
}
