/** Trusted static bootstrap; user bytes arrive only after native network isolation is proven. */

/** Host path reserved for the opaque HTML preview document. */
export const isolatedHtmlPath = '/assets/document-preview/isolated-html'

/** CSP complements the network policy with passive resource and navigation restrictions. */
export const isolatedHtmlCsp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

/** Static document contains no workspace data, credentials, resource proxy or reporting endpoint. */
export const isolatedHtmlBootstrap = `<!doctype html><meta charset="utf-8"><script>(()=>{
let token,ready=false,settled=false,observer,timer;
const send=type=>parent.postMessage({type,token},'*');
const receive=event=>{
  if(event.source!==parent||!event.data||typeof event.data!=='object')return;
  const data=event.data;
  if(data.type==='dsh-html-init'&&token===undefined&&typeof data.token==='string'){
    token=data.token;
    if(typeof ReportingObserver!=='function'||typeof RTCPeerConnection!=='function'){
      send('dsh-html-unavailable');return;
    }
    timer=setTimeout(()=>{settled=true;observer.disconnect();send('dsh-html-unavailable')},5000);
    const accept=reports=>{
      if(settled)return;
      if(!reports.some(report=>report.type==='connection-allowlist'&&report.body.connection==='webrtc'&&report.body.disposition==='enforce'&&Array.isArray(report.body.allowlist)&&report.body.allowlist.length===0))return;
      settled=true;observer.disconnect();clearTimeout(timer);ready=true;send('dsh-html-ready');
    };
    observer=new ReportingObserver(accept,{types:['connection-allowlist']});
    observer.observe();
    try{new RTCPeerConnection().close()}catch{/* Native policy may throw and still enqueue its enforcement report. */}
    accept(observer.takeRecords());
  }else if(data.type==='dsh-html-render'&&ready&&data.token===token&&typeof data.html==='string'){
    ready=false;removeEventListener('message',receive);
    document.open();document.write(data.html);document.close();
  }
};
addEventListener('message',receive);
})()</script>`
