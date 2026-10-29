"use strict";
const button=document.getElementById("save"),status=document.getElementById("status");
button.addEventListener("click",async()=>{button.disabled=true;status.dataset.state="working";status.textContent="Capturing page and resources…";
try{const result=await browser.runtime.sendMessage({type:"SAVE_CURRENT_TAB"});if(!result?.ok)throw new Error(result?.error||"Capture failed");status.dataset.state="success";status.textContent=`Save As requested. ${result.resources} resource(s) embedded${result.failed?`; ${result.failed} unavailable`:""}.`}
catch(error){status.dataset.state="error";status.textContent=`Error: ${error?.message||String(error)}`}
finally{button.disabled=false}});
