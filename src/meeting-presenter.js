/* Responsive one-card-at-a-time Advisor Meeting presentation. No copied KPIs. */
(function(root){
  "use strict";
  const api=root.__moondogDaily,model=api?.model;
  if(!api||!model)return;
  const state={enabled:false,paused:false,index:0,timer:null,view:null,controls:null,seconds:30,cardHost:null,cardNodes:[]};
  const $=id=>document.getElementById(id);
  function setting(){const prefs=api.presentationSettings?.()||{};return {
    seconds:Number.isInteger(prefs.seconds)&&prefs.seconds>=10&&prefs.seconds<=120?prefs.seconds:30,
    orientation:["auto","landscape","portrait"].includes(prefs.orientation)?prefs.orientation:"auto"
  };}
  function cards(){
    const parent=$("meetingV3Advisors");
    if(!parent){state.cardHost=null;state.cardNodes=[];return [];}
    const nodes=[...parent.querySelectorAll(".meeting-v3-advisor")];
    // Reorder only when the data renderer replaces card nodes. Re-appending on
    // every Next/Pause used to invalidate layout for the entire TV stage.
    const changed=state.cardHost!==parent||nodes.length!==state.cardNodes.length||
      nodes.some(node=>!state.cardNodes.includes(node));
    if(changed){
      const ordered=nodes.sort((a,b)=>
        (a.querySelector("h3")?.textContent||"").localeCompare(b.querySelector("h3")?.textContent||"",undefined,{sensitivity:"base",numeric:true}));
      ordered.forEach((node,i)=>{if(parent.children[i]!==node)parent.insertBefore(node,parent.children[i]||null);});
      state.cardHost=parent;state.cardNodes=ordered;
    }
    return state.cardNodes;
  }
  function viewReady(){const view=$("view-meeting");return view?.classList.contains("meeting-scoreboard")?view:null;}
  function stopTimer(){if(state.timer){clearInterval(state.timer);state.timer=null;}}
  function restartTimer(){stopTimer();if(!state.enabled||state.paused||!state.view?.classList.contains("active"))return;
    state.timer=setInterval(()=>{if(document.hidden||!state.view?.classList.contains("active"))return;next();},state.seconds*1000);
  }
  function paint(){
    const view=viewReady();if(!view)return;
    state.view=view;
    const list=cards(),count=1+list.length;
    state.index=Math.max(0,Math.min(state.index,count-1));
    const selected=state.index===0?null:list[state.index-1];
    const visible=state.enabled&&view.classList.contains("active");
    view.classList.toggle("presentation-active",visible);
    const slide=selected?"advisor":"store",orientation=setting().orientation;
    if(view.dataset.presenterSlide!==slide)view.dataset.presenterSlide=slide;
    if(view.dataset.presenterOrientation!==orientation)view.dataset.presenterOrientation=orientation;
    for(const card of list){
      const active=String(Boolean(visible&&card===selected));
      if(card.dataset.slideActive!==active)card.dataset.slideActive=active;
    }
    if(state.controls){
      const label=state.controls.querySelector("[data-slide-label]");
      if(label)label.textContent=`${selected?selected.querySelector("h3")?.textContent||"Advisor":"Store"} · ${state.index+1} of ${count}`;
      const paused=state.controls.querySelector("[data-pause]");
      if(paused)paused.textContent=state.paused?"Resume":"Pause";
      const overview=state.controls.querySelector("[data-overview]");
      if(overview)overview.textContent=state.enabled?"Show overview":"Start cards";
    }
  }
  function next(){const count=1+cards().length;if(!count)return;
    state.index=(state.index+1)%count;paint();
  }
  function toggle(){state.enabled=!state.enabled;state.paused=false;state.index=0;paint();restartTimer();}
  function pause(){if(!state.enabled)return;state.paused=!state.paused;paint();restartTimer();}
  function activate(){
    const view=viewReady();if(!view)return;
    ensureControls();
    if(!state.enabled){state.enabled=true;state.paused=false;state.index=0;}
    state.seconds=setting().seconds;paint();restartTimer();
  }
  function syncFullscreenLabel(){
    const button=state.controls?.querySelector("[data-fullscreen]");
    if(!button)return;
    const active=Boolean(document.fullscreenElement);
    button.textContent=active?"Exit full screen":"Full screen";
    button.setAttribute("aria-pressed",String(active));
  }
  function ensureControls(){
    const view=viewReady();if(!view)return;
    const host=view.querySelector(".meeting-scoreboard-actions");
    if(!host)return;
    // The original Meeting page also carries a legacy fullscreen button.
    // Retain its JS reference but expose ONE canonical control to users.
    const legacy=$("meetingFullscreen");
    if(legacy){legacy.hidden=true;legacy.tabIndex=-1;legacy.setAttribute("aria-hidden","true");}
    let controls=host.querySelector(".meeting-presenter-controls");
    if(!controls){
      controls=document.createElement("div");controls.className="meeting-presenter-controls";
      controls.innerHTML=`<strong data-slide-label>Store · 1 of 1</strong>
        <button type="button" data-pause>Pause</button><button type="button" data-next>Next</button>
        <button type="button" data-fullscreen>Full screen</button>
        <button type="button" data-overview>Show overview</button><small role="status" aria-live="polite" data-fullscreen-help hidden></small>`;
      controls.querySelector("[data-pause]").addEventListener("click",pause);
      controls.querySelector("[data-next]").addEventListener("click",()=>{if(!state.enabled)state.enabled=true;next();restartTimer();});
      controls.querySelector("[data-overview]").addEventListener("click",toggle);
      controls.querySelector("[data-fullscreen]").addEventListener("click",async()=>{
        const current=viewReady();
        if(!current)return;
        const button=controls.querySelector("[data-fullscreen]");
        if(button.disabled)return;
        button.disabled=true;
        const help=controls.querySelector("[data-fullscreen-help]");
        if(help){help.hidden=true;help.textContent="";}
        try{
          if(document.fullscreenElement)await document.exitFullscreen();
          else if(!document.fullscreenEnabled)throw new Error("fullscreen unavailable");
          else await current.requestFullscreen();
        }catch(_){
          // A Split Screen pane or browser policy can deny fullscreen.
          // Never leave the manager with a silent button.
          if(help){
            help.textContent="Full screen was blocked by Edge. Exit Split Screen or try F11.";
            help.hidden=false;
          }
        }finally{button.disabled=false;syncFullscreenLabel();}
      });
      host.prepend(controls);
    }
    state.controls=controls;
    syncFullscreenLabel();
  }
  function installPreferences(){
    const area=[...document.querySelectorAll("#view-settings .settings-card")].find(card=>
      card.querySelector("h2")?.textContent?.trim()==="Advisor Meeting");
    if(!area||area.querySelector(".meeting-presentation-settings"))return;
    const prefs=setting(),wrap=document.createElement("div");
    wrap.className="meeting-presentation-settings";
    wrap.innerHTML=`<h3>TV meeting cards</h3><p>One Store card, then each advisor by name. The cards repeat.</p>
      <div class="settings-grid">
      <label>Seconds per card<input type="number" min="10" max="120" step="1" data-presenter-seconds></label>
      <label>Screen layout<select data-presenter-orientation>
        <option value="auto">Auto</option><option value="landscape">16:9 (wide)</option>
        <option value="portrait">9:16 (tall)</option></select></label></div>
      <small aria-live="polite" data-presenter-save></small>`;
    const duration=wrap.querySelector("[data-presenter-seconds]"),orientation=wrap.querySelector("[data-presenter-orientation]"),message=wrap.querySelector("[data-presenter-save]");
    duration.value=String(prefs.seconds);orientation.value=prefs.orientation;
    const persist=async()=>{
      const seconds=Number(duration.value);
      if(!Number.isInteger(seconds)||seconds<10||seconds>120){message.textContent="Choose between 10 and 120 seconds.";return;}
      const previous=setting();
      try{
        await api.savePresentationSettings({seconds,orientation:orientation.value});
        state.seconds=seconds;message.textContent="Saved to this working folder.";paint();restartTimer();
      }catch(error){duration.value=String(previous.seconds);orientation.value=previous.orientation;
        message.textContent=error?.message||"Preferences could not be saved in this working folder.";}
    };
    duration.addEventListener("change",persist);orientation.addEventListener("change",persist);
    area.append(wrap);
  }
  document.addEventListener("moondog-navigation",event=>{
    if(event.detail?.view==="meeting")queueMicrotask(activate);
    else if(event.detail?.view){stopTimer();paint();}
  });
  document.addEventListener("moondog-data",()=>{installPreferences();ensureControls();paint();});
  document.addEventListener("moondog-recovered",()=>{stopTimer();state.index=0;state.enabled=false;paint();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stopTimer();else restartTimer();});
  // Fullscreen resize must not rebuild the meeting or reorder advisor cards.
  document.addEventListener("fullscreenchange",syncFullscreenLabel);
  window.addEventListener("beforeunload",stopTimer);
  installPreferences();ensureControls();
  if(viewReady()?.classList.contains("active"))activate();
  root.__serviceMeetingPresenter=Object.freeze({next,paint,setting,cards,activate});
})(globalThis);
