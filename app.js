/* REGENIX — Smart Hybrid Energy System Frontend Logic & API Sync */

const state = {
  page: "dashboard",
  live: true,
  animation: true,
  labels: true,
  notifications: true,
  solar: 128,
  wind: 74,
  battery: 72,
  load: 146,
  backendConnected: false,
  historyGen: [82, 91, 104, 119, 128, 142, 154, 167, 182, 195, 202],
  historySoc: [61, 64, 66, 69, 73, 75, 74, 72, 71, 72]
};

const pageTitles = {
  dashboard:"Dashboard", "3d":"3D System", monitoring:"Real-Time Monitoring",
  generation:"Generation", battery:"Battery & BMS", switching:"Hybrid Switching",
  loads:"Load Management", ai:"AI & Optimization", weather:"Weather & Forecast",
  optimizer:"Optimization Engine", simulator:"What-If Simulator", analytics:"Analytics",
  ev:"EV Management", alerts:"Faults & Alerts", maintenance:"Maintenance",
  reports:"Reports", carbon:"Carbon Savings", settings:"Settings"
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Page Navigation */
function go(page){
  if(!page || !pageTitles[page]) return;
  state.page = page;
  $$(".page").forEach(p => p.classList.toggle("active-page", p.dataset.pageContent === page));
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  window.scrollTo({top:0, behavior:"smooth"});
  
  // Close mobile sidebar if open
  closeMobileSidebar();

  if(page === "3d") setTimeout(()=>resizeRenderer({renderer:detailRenderer,camera:detailCamera}, detailSceneContainer),60);
  if(page === "dashboard") setTimeout(()=>resizeRenderer({renderer:mainRenderer,camera:mainCamera}, mainSceneContainer),60);
  if(page === "3d") setTimeout(updateLabelVisibility,60);
}

document.addEventListener("click", e => {
  const target = e.target.closest("[data-go]");
  if(target){ e.preventDefault(); go(target.dataset.go); }
});
$$(".nav-item").forEach(btn => btn.addEventListener("click", ()=>go(btn.dataset.page)));

/* Toast Alerts */
function toast(message){
  const el=$("#toast");
  if(!el) return;
  el.textContent=message;
  el.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast=setTimeout(()=>el.classList.remove("show"),2600);
}

/* Live Clock */
function updateClock(){
  const now=new Date();
  const t=now.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  const clockEl = $("#clock");
  const updateEl = $("#lastUpdate");
  if(clockEl) clockEl.textContent = t;
  if(updateEl) updateEl.textContent = t;
}
setInterval(updateClock,1000); updateClock();

/* Mobile Sidebar Drawer */
const mobileMenuBtn = $("#mobileMenuBtn");
const sidebarCloseBtn = $("#sidebarCloseBtn");
const sidebarBackdrop = $("#sidebarBackdrop");
const sidebar = $("#sidebar");

function openMobileSidebar(){
  sidebar?.classList.add("open");
  sidebarBackdrop?.classList.add("active");
}
function closeMobileSidebar(){
  sidebar?.classList.remove("open");
  sidebarBackdrop?.classList.remove("active");
}
mobileMenuBtn?.addEventListener("click", openMobileSidebar);
sidebarCloseBtn?.addEventListener("click", closeMobileSidebar);
sidebarBackdrop?.addEventListener("click", closeMobileSidebar);

/* Notification Center Drawer */
const notificationBtn = $("#notificationBtn");
const closeDrawerBtn = $("#closeDrawerBtn");
const notificationDrawer = $("#notificationDrawer");
const drawerOverlay = $("#drawerOverlay");

function openNotificationDrawer(){
  notificationDrawer?.classList.add("open");
  drawerOverlay?.classList.add("open");
  fetchAlerts();
}
function closeNotificationDrawer(){
  notificationDrawer?.classList.remove("open");
  drawerOverlay?.classList.remove("open");
}
notificationBtn?.addEventListener("click", openNotificationDrawer);
closeDrawerBtn?.addEventListener("click", closeNotificationDrawer);
drawerOverlay?.addEventListener("click", closeNotificationDrawer);

/* Interactive Search Dropdown */
const searchInput = $("#searchInput");
const searchDropdown = $("#searchDropdown");

searchInput?.addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  if(!q){
    searchDropdown.classList.remove("show");
    return;
  }
  const matches = Object.keys(pageTitles).filter(k => pageTitles[k].toLowerCase().includes(q));
  if(matches.length > 0){
    searchDropdown.innerHTML = matches.map(k => `
      <div class="search-item" data-go="${k}">
        <span>${pageTitles[k]}</span>
        <small style="color:#6f8997">Open page →</small>
      </div>
    `).join("");
    searchDropdown.classList.add("show");
  } else {
    searchDropdown.innerHTML = `<div class="search-item" style="color:#6f8997">No matching pages found</div>`;
    searchDropdown.classList.add("show");
  }
});
searchInput?.addEventListener("keydown", e=>{
  if(e.key!=="Enter") return;
  const q=e.target.value.trim().toLowerCase();
  if(!q) return;
  const found=Object.keys(pageTitles).find(k=>pageTitles[k].toLowerCase().includes(q));
  if(found){ go(found); toast(`Opened ${pageTitles[found]}`); searchDropdown.classList.remove("show"); }
  else toast("No matching REGENIX page found.");
});
document.addEventListener("click", e => {
  if(!e.target.closest(".search")) searchDropdown?.classList.remove("show");
});

/* Load Management Relays API Sync */
$$("[data-load]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const loadId = btn.dataset.load;
    const isCurrentlyActive = btn.classList.contains("active");
    const targetState = !isCurrentlyActive;
    
    // UI optimistic update
    btn.classList.toggle("active", targetState);
    btn.textContent = targetState ? "ON" : "OFF";
    
    if(state.backendConnected){
      try {
        await fetch("/api/loads/toggle", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({load_id: loadId, enabled: targetState})
        });
        toast(`${loadId.toUpperCase()} load relay turned ${targetState ? "ON" : "OFF"}`);
        fetchLiveTelemetry();
      } catch(err) {
        toast(`Load relay updated (Offline simulation)`);
      }
    } else {
      toast(`${loadId.toUpperCase()} load turned ${targetState ? "ON" : "OFF"}`);
    }
  });
});

/* EV Management Mode Selector API Sync */
$$("[data-ev-mode]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const mode = btn.dataset.evMode;
    $$("[data-ev-mode]").forEach(b => b.classList.toggle("active", b === btn));
    
    if(state.backendConnected){
      try {
        await fetch("/api/ev/control", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({mode})
        });
        toast(`EV charging mode set to: ${mode.toUpperCase()}`);
        fetchLiveTelemetry();
      } catch(err){
        toast(`EV mode set to: ${mode.toUpperCase()}`);
      }
    } else {
      toast(`EV mode set to: ${mode.toUpperCase()}`);
    }
  });
});

  /* Fault Injection API Handlers */
  let offlineAlerts = [];

  function simulateOfflineFault() {
    toast("?? Overload fault simulated (Offline Mode)");
    offlineAlerts.unshift({
      level: "critical", 
      title: "CRITICAL OVERLOAD TRIP (Simulation)", 
      message: "System load exceeded 1.5 kW safety limit! Dynamic load shedding triggered.", 
      acknowledged: 0, 
      time: new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})
    });
    renderAlertsList(offlineAlerts);
  }

  async function triggerDemoFault(){
    if(state.backendConnected){
      try {
        await fetch("/api/alerts/trigger", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({type: "OVERLOAD"})
        });
        toast("?? DEMO FAULT INJECTED: Critical System Overload!");
        fetchAlerts();
        fetchLiveTelemetry();
      } catch(err){
        simulateOfflineFault();
      }
    } else {
      simulateOfflineFault();
    }
  }
  $("#triggerFaultBtn")?.addEventListener("click", triggerDemoFault);
  $("#drawerTriggerFaultBtn")?.addEventListener("click", triggerDemoFault);
  
  /* Acknowledge Alerts API Handlers */
  async function acknowledgeAlerts(){
    if(state.backendConnected){
      try {
        await fetch("/api/alerts/acknowledge", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({})
        });
        toast("? All system alerts acknowledged");
        fetchAlerts();
      } catch(err){
        offlineAlerts = [];
        renderAlertsList(offlineAlerts);
        toast("? Alerts cleared");
      }
    } else {
      offlineAlerts = [];
      renderAlertsList(offlineAlerts);
      toast("? Alerts cleared");
    }
  }
  $("#ackAlertsBtn")?.addEventListener("click", acknowledgeAlerts);
  $("#drawerAckAllBtn")?.addEventListener("click", acknowledgeAlerts);

  async function fetchAlerts(){
    if(!state.backendConnected) {
      renderAlertsList(offlineAlerts);
      return;
    }
    try {
      const res = await fetch("/api/alerts");
      const data = await res.json();
      renderAlertsList(data.alerts || []);
    } catch(err){
      console.error("Alerts fetch error:", err);
      renderAlertsList(offlineAlerts);
    }
  }

function renderAlertsList(alerts){
  const badge = $("#notifBadge");
  const drawerBody = $("#drawerAlertList");
  const alertsPageList = $("#alertsPageList");
  
  const unackCount = alerts.filter(a => !a.acknowledged).length;
  if(badge) badge.textContent = unackCount;
  
  if(!alerts || alerts.length === 0){
    const emptyHtml = `<div class="alert good"><span>✓</span><div><b>All Systems Normal</b><small>No active system warnings or faults.</small></div><time>Now</time></div>`;
    if(drawerBody) drawerBody.innerHTML = emptyHtml;
    if(alertsPageList) alertsPageList.innerHTML = emptyHtml;
    return;
  }
  
  const html = alerts.map(a => {
    const icon = a.level === "critical" ? "⚠️" : (a.level === "warning" ? "!" : (a.level === "info" ? "i" : "✓"));
    const cls = a.level;
    return `
      <div class="alert ${cls}">
        <span>${icon}</span>
        <div><b>${a.title}</b><small>${a.message}</small></div>
        <time>${a.time ? a.time.split(" ")[1] || "Now" : "Now"}</time>
      </div>
    `;
  }).join("");
  
  if(drawerBody) drawerBody.innerHTML = html;
  if(alertsPageList) alertsPageList.innerHTML = html;
}

/* =========================================================
   REACTIVE DATA BINDING FOR ALL 14 PAGES
   ========================================================= */
function renderTelemetry(data){
  const solarP = data.solar.power;
  const solarV = data.solar.voltage;
  const solarA = data.solar.current;
  
  const windP = data.wind.power;
  const windV = data.wind.voltage;
  const windA = data.wind.current;
  
  const battSoc = Math.round(data.battery.soc);
  const battV = data.battery.voltage;
  const battA = data.battery.current;
  const battStatus = data.battery.status;
  
  const loadP = data.totals.consumption;
  const genP = data.totals.generation;
  const eff = data.totals.efficiency;
  
  state.solar = solarP;
  state.wind = windP;
  state.battery = battSoc;
  state.load = loadP;

  // 1. DASHBOARD PAGE
  if($("#solarPower")) $("#solarPower").textContent = `${solarP} W`;
  if($("#solarSub")) $("#solarSub").textContent = `${solarV} V • ${solarA} A`;
  
  if($("#windPower")) $("#windPower").textContent = `${windP} W`;
  if($("#windSub")) $("#windSub").textContent = `${windV} V • ${windA} A`;
  
  if($("#batteryPower")) $("#batteryPower").textContent = `${battSoc}%`;
  if($("#batterySub")) $("#batterySub").textContent = `${battV} V • ${battA} A`;
  
  if($("#loadPower")) $("#loadPower").textContent = `${loadP} W`;
  if($("#loadSub")) $("#loadSub").textContent = `230 V • ${roundVal(loadP/230, 2)} A`;
  
  if($("#totalGeneration")) $("#totalGeneration").textContent = `${genP} W`;
  if($("#totalConsumption")) $("#totalConsumption").textContent = `${loadP} W`;
  if($("#dashMetricEff")) $("#dashMetricEff").textContent = `${eff}%`;
  if($("#dashEfficiency")) $("#dashEfficiency").textContent = `${eff}%`;
  if($("#dashEffBar")) $("#dashEffBar").style.width = `${eff}%`;
  
  if($("#solarPct")) $("#solarPct").textContent = `${data.totals.solar_pct}%`;
  if($("#windPct")) $("#windPct").textContent = `${data.totals.wind_pct}%`;
  if($("#batteryPct")) $("#batteryPct").textContent = `${data.totals.battery_pct}%`;

  if(data.loads){
    if($("#dashCritStatus")){
      $("#dashCritStatus").textContent = data.loads.critical?.enabled ? "ON" : "OFF";
      $("#dashCritStatus").className = data.loads.critical?.enabled ? "on" : "muted";
    }
    if($("#dashCritPower")) $("#dashCritPower").textContent = `${data.loads.critical?.power || 0} W`;
    
    if($("#dashImpStatus")){
      $("#dashImpStatus").textContent = data.loads.important?.enabled ? "ON" : "OFF";
      $("#dashImpStatus").className = data.loads.important?.enabled ? "on" : "muted";
    }
    if($("#dashImpPower")) $("#dashImpPower").textContent = `${data.loads.important?.power || 0} W`;
    
    if($("#dashNonCritStatus")){
      $("#dashNonCritStatus").textContent = data.loads.noncritical?.enabled ? "ON" : "OFF";
      $("#dashNonCritStatus").className = data.loads.noncritical?.enabled ? "on" : "muted";
    }
    if($("#dashNonCritPower")) $("#dashNonCritPower").textContent = `${data.loads.noncritical?.power || 0} W`;
  }

  if(data.carbon){
    if($("#dashCarbonKg")) $("#dashCarbonKg").textContent = `${data.carbon.co2_saved_kg}`;
    if($("#dashCarbonTrees")) $("#dashCarbonTrees").textContent = `${data.carbon.trees_equivalent}`;
    if($("#dashCarbonKm")) $("#dashCarbonKm").textContent = `${data.carbon.km_avoided} km`;
  }

  // 2. 3D SYSTEM PAGE
  if($("#3dSolar")) $("#3dSolar").textContent = `${solarP} W`;
  if($("#3dSolarSub")) $("#3dSolarSub").textContent = `${solarV} V • ${solarA} A`;
  if($("#3dWind")) $("#3dWind").textContent = `${windP} W`;
  if($("#3dWindSub")) $("#3dWindSub").textContent = `${windV} V • ${windA} A`;
  if($("#3dBattery")) $("#3dBattery").textContent = `${battSoc}%`;
  if($("#3dBatterySub")) $("#3dBatterySub").textContent = `${battV} V • ${battA} A`;
  if($("#3dLoad")) $("#3dLoad").textContent = `${loadP} W`;
  if($("#3dLoadSub")) $("#3dLoadSub").textContent = `230 V • ${roundVal(loadP/230, 2)} A`;

  // 3. REAL-TIME MONITORING PAGE
  if($("#monSolarV")) $("#monSolarV").textContent = `${solarV} V`;
  if($("#monWindV")) $("#monWindV").textContent = `${windV} V`;
  if($("#monBattA")) $("#monBattA").textContent = `${battA} A`;
  if($("#monBattStatus")) $("#monBattStatus").textContent = battStatus;
  if($("#monLoadP")) $("#monLoadP").textContent = `${loadP} W`;
  
  if($("#monTblSolarV")) $("#monTblSolarV").textContent = `${solarV} V`;
  if($("#monTblSolarA")) $("#monTblSolarA").textContent = `${solarA} A`;
  if($("#monTblSolarP")) $("#monTblSolarP").textContent = `${solarP} W`;
  
  if($("#monTblWindV")) $("#monTblWindV").textContent = `${windV} V`;
  if($("#monTblWindA")) $("#monTblWindA").textContent = `${windA} A`;
  if($("#monTblWindP")) $("#monTblWindP").textContent = `${windP} W`;
  
  if($("#monTblBattV")) $("#monTblBattV").textContent = `${battV} V`;
  if($("#monTblBattA")) $("#monTblBattA").textContent = `${battA} A`;
  if($("#monTblBattP")) $("#monTblBattP").textContent = `${Math.abs(Math.round(battV * battA))} W`;
  if($("#monTblBattSt")) $("#monTblBattSt").textContent = battStatus;
  
  if($("#monTblLoadA")) $("#monTblLoadA").textContent = `${roundVal(loadP/230, 2)} A`;
  if($("#monTblLoadP")) $("#monTblLoadP").textContent = `${loadP} W`;

  // 4. GENERATION PAGE
  if($("#genSolarP")) $("#genSolarP").textContent = `${solarP} W`;
  if($("#genSolarSub")) $("#genSolarSub").textContent = `${solarV} V • ${solarA} A`;
  const solarCapPct = Math.min(100, Math.round(solarP / 1.88));
  if($("#genSolarBar")) $("#genSolarBar").style.width = `${solarCapPct}%`;
  if($("#genSolarCap")) $("#genSolarCap").textContent = `${solarCapPct}% of available solar capacity`;
  
  if($("#genWindP")) $("#genWindP").textContent = `${windP} W`;
  if($("#genWindSub")) $("#genWindSub").textContent = `${windV} V • ${windA} A`;
  const windCapPct = Math.min(100, Math.round(windP / 1.75));
  if($("#genWindBar")) $("#genWindBar").style.width = `${windCapPct}%`;
  if($("#genWindCap")) $("#genWindCap").textContent = `${windCapPct}% of available wind capacity`;

  // 5. BATTERY & BMS PAGE
  if($("#battFill")) $("#battFill").style.height = `${battSoc}%`;
  if($("#battFillText")) $("#battFillText").textContent = `${battSoc}%`;
  if($("#battV")) $("#battV").textContent = `${battV} V`;
  if($("#battA")) $("#battA").textContent = `${battA} A`;
  if($("#battStatusText")) $("#battStatusText").textContent = battStatus;
  if($("#battThreshSoc")) $("#battThreshSoc").textContent = `Battery SoC = ${battSoc}%`;

  if($("#threshRow1")) $("#threshRow1").className = battSoc >= 50 ? "on" : "muted";
  if($("#threshRow2")) $("#threshRow2").className = (battSoc >= 40 && battSoc < 50) ? "on" : "muted";
  if($("#threshRow3")) $("#threshRow3").className = battSoc < 20 ? "on" : "muted";

  // 6. HYBRID SWITCHING PAGE
  if($("#switchSolarP")) $("#switchSolarP").textContent = `${solarP} W`;
  if($("#switchLoadP")) $("#switchLoadP").textContent = `${loadP} W`;
  if($("#switchDecision")){
    if(solarP > windP && genP >= loadP) $("#switchDecision").textContent = "SOLAR PRIORITY";
    else if(windP >= solarP && genP >= loadP) $("#switchDecision").textContent = "WIND PRIORITY";
    else $("#switchDecision").textContent = "BATTERY SUPPORT";
  }

  // 7. LOAD MANAGEMENT PAGE
  if(data.loads){
    if($("#loadsCritPower")) $("#loadsCritPower").textContent = `${data.loads.critical?.power || 0} W`;
    if($("#loadsImpPower")) $("#loadsImpPower").textContent = `${data.loads.important?.power || 0} W`;
    if($("#loadsNonCritPower")) $("#loadsNonCritPower").textContent = `${data.loads.noncritical?.power || 0} W`;
  }

  // 8. AI & OPTIMIZATION PAGE
  if(data.ai){
    if($("#aiForecastP")) $("#aiForecastP").textContent = `${data.ai.forecast_1h} W`;
    if($("#aiRecText")) $("#aiRecText").textContent = data.ai.recommendation;
    if($("#aiRenewablePct")) $("#aiRenewablePct").textContent = `${Math.min(100, Math.round(genP / maxVal(1, loadP) * 100))}%`;
    if($("#aiScoreText")) $("#aiScoreText").textContent = `${data.ai.score} / 100`;
    if($("#aiScoreBar")) $("#aiScoreBar").style.width = `${data.ai.score}%`;
  }

  // 9. EV MANAGEMENT PAGE
  if(data.ev){
    if($("#evChargerPower")) $("#evChargerPower").textContent = `${data.loads.ev?.power || 0} W`;
    if($("#evModeBadge")) $("#evModeBadge").textContent = `MODE: ${data.ev.mode.toUpperCase()}`;
  }

  // 12. REPORTS PAGE
  if($("#repGen")) $("#repGen").textContent = `${genP} Wh`;
  if($("#repCons")) $("#repCons").textContent = `${loadP} Wh`;
  if($("#repEff")) $("#repEff").textContent = `${eff}%`;
  if($("#repCo2") && data.carbon) $("#repCo2").textContent = `${data.carbon.co2_saved_kg} kg`;

  // 13. CARBON SAVINGS PAGE
  if(data.carbon){
    if($("#carbonRingKg")) $("#carbonRingKg").textContent = `${data.carbon.co2_saved_kg}`;
    if($("#carbonTreesCnt")) $("#carbonTreesCnt").textContent = `${data.carbon.trees_equivalent}`;
    if($("#carbonCarKm")) $("#carbonCarKm").textContent = `${data.carbon.km_avoided} km`;
    if($("#carbonWhGen")) $("#carbonWhGen").textContent = `${genP} Wh`;
  }

  update3DLabels();
}

function roundVal(v, decimals=1){
  return Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
function maxVal(a, b){ return Math.max(a, b); }

/* Fetch Live Telemetry API */
async function fetchLiveTelemetry(){
  if(!state.live) return;
  try {
    const res = await fetch("/api/telemetry/live");
    if(res.ok){
      const data = await res.json();
      state.backendConnected = true;
      const connStatus = $("#connectionStatus");
      if(connStatus) connStatus.innerHTML = `<i></i> Server Connected`;
      renderTelemetry(data);
    } else {
      throw new Error("API non-200");
    }
  } catch(err){
    state.backendConnected = false;
    const connStatus = $("#connectionStatus");
    if(connStatus) connStatus.innerHTML = `<i style="background:#ff9800"></i> Offline Simulation`;
    
    // Offline simulation fallback
    simulateOfflineTelemetry();
  }
}

function simulateOfflineTelemetry(){
  state.solar=Math.max(95, Math.round(128 + Math.sin(Date.now()/6500)*18));
  state.wind=Math.max(45, Math.round(74 + Math.sin(Date.now()/4100)*16));
  state.battery=Math.min(100,Math.max(20,Math.round(72 + Math.sin(Date.now()/11000)*3)));
  state.load=Math.max(110,Math.round(146 + Math.sin(Date.now()/5200)*10));
  const generation=state.solar+state.wind;
  const solarPct=Math.round(state.solar/generation*100);
  const windPct=Math.round(state.wind/generation*100);
  const batteryPct=Math.max(0,100-solarPct-windPct);

  renderTelemetry({
    solar: {power: state.solar, voltage: 18.4, current: roundVal(state.solar/18.4, 1)},
    wind: {power: state.wind, voltage: 12.7, current: roundVal(state.wind/12.7, 1)},
    battery: {soc: state.battery, voltage: 12.4, current: -3.2, status: "DISCHARGING"},
    totals: {generation, consumption: state.load, efficiency: 91, solar_pct: solarPct, wind_pct: windPct, battery_pct: batteryPct},
    loads: {
      critical: {power: 72, enabled: true},
      important: {power: 48, enabled: true},
      noncritical: {power: 26, enabled: true},
      ev: {power: 0, enabled: false}
    },
    ev: {mode: "eco"},
    carbon: {co2_saved_kg: 128.6, trees_equivalent: 9, km_avoided: 542},
    ai: {score: 94, forecast_1h: state.load + 12, recommendation: "Use Solar + Wind"}
  });
}

setInterval(fetchLiveTelemetry, 2000);
fetchLiveTelemetry();

/* Fetch Rolling History for Charts */
async function fetchChartHistory(){
  if(!state.backendConnected) return;
  try {
    const res = await fetch("/api/telemetry/history");
    if(res.ok){
      const data = await res.json();
      if(data.generation && data.generation.length > 0) state.historyGen = data.generation;
      if(data.battery_soc && data.battery_soc.length > 0) state.historySoc = data.battery_soc;
      renderCharts();
    }
  } catch(err){}
}
setInterval(fetchChartHistory, 6000);

/* Canvas Line Charts */
function drawLineChart(canvas, values, lineColor, fillColor){
  if(!canvas) return;
  const rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  const w=Math.max(300,rect.width), h=Math.max(150,rect.height);
  canvas.width=w*dpr; canvas.height=h*dpr;
  const ctx=canvas.getContext("2d"); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle="#12303e";ctx.lineWidth=1;
  for(let i=1;i<5;i++){let y=i*h/5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const min=Math.min(...values)-5,max=Math.max(...values)+5;
  const pts=values.map((v,i)=>[i*(w/(values.length-1)),h-((v-min)/(max-min))*h*.72-h*.1]);
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle=fillColor;ctx.fill();
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle=lineColor;ctx.lineWidth=2;ctx.stroke();
}

function renderCharts(){
  drawLineChart($("#generationChart"), state.historyGen, "#2ee57d", "rgba(46,229,125,.08)");
  drawLineChart($("#batteryChart"), state.historySoc, "#3bbcff", "rgba(59,188,255,.08)");
}
setTimeout(renderCharts,100);
window.addEventListener("resize",renderCharts);

/* =========================================================
   AI WEATHER, FORECAST, OPTIMIZATION, SIMULATOR, ANALYTICS
   ========================================================= */

const weatherIcons = {
  "Clear":"☀","Partly Cloudy":"⛅","Cloudy":"☁","Overcast":"☁","Rain":"🌧","Storm":"⛈","Night Clear":"🌙","Night Cloudy":"☁"
};

/* ---- Multi-line / Area chart drawer ---- */
function drawMultiLineChart(canvas, datasets, options={}){
  if(!canvas) return;
  const rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  const w=Math.max(300,rect.width), h=Math.max(150,rect.height);
  canvas.width=w*dpr; canvas.height=h*dpr;
  const ctx=canvas.getContext("2d"); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);

  // Grid
  ctx.strokeStyle="#12303e";ctx.lineWidth=1;
  for(let i=1;i<5;i++){let y=i*h/5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}

  // Labels
  if(options.labels && options.labels.length){
    ctx.font="9px Inter";ctx.fillStyle="#4a6d7d";
    const step = Math.max(1, Math.floor(options.labels.length / 8));
    options.labels.forEach((lbl,i)=>{
      if(i % step === 0){
        const x = i * (w/(options.labels.length-1));
        ctx.fillText(lbl, x, h-2);
      }
    });
  }

  datasets.forEach(ds => {
    const values = ds.values;
    if(!values || values.length < 2) return;
    let allVals = datasets.flatMap(d=>d.values||[]);
    const min = Math.min(...allVals)-2, max = Math.max(...allVals)+2;
    const range = max-min||1;
    const pts = values.map((v,i)=>[i*(w/(values.length-1)), h-18-((v-min)/range)*(h-25)]);

    // Fill area
    if(ds.fill){
      ctx.beginPath();
      pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));
      ctx.lineTo(w,h-18);ctx.lineTo(0,h-18);ctx.closePath();
      ctx.fillStyle=ds.fill;ctx.fill();
    }
    // Line
    ctx.beginPath();
    pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));
    ctx.strokeStyle=ds.color||"#3eed84";
    ctx.lineWidth=ds.width||2;
    if(ds.dash) ctx.setLineDash(ds.dash);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

/* ---- Weather Page ---- */
async function fetchWeather(){
  try {
    const [curRes, fcRes] = await Promise.all([
      fetch("/api/weather/current"),
      fetch("/api/weather/forecast")
    ]);
    if(curRes.ok){
      const cur = await curRes.json();
      const icon = weatherIcons[cur.weather_condition] || "☀";
      const el = (id,v) => { const e=$(id); if(e) e.textContent = v; };
      el("#weatherIcon", icon);
      el("#weatherTemp", `${Math.round(cur.temperature)}°C`);
      el("#weatherCondition", cur.weather_condition);
      el("#weatherHumidity", `${Math.round(cur.humidity)}%`);
      el("#weatherWindSpeed", `${cur.wind_speed.toFixed(1)} m/s`);
      el("#weatherIrradiance", `${Math.round(cur.solar_irradiance)} W/m²`);
      el("#weatherCloud", `${Math.round(cur.cloud_cover)}%`);
      el("#weatherPressure", `${Math.round(cur.pressure)} hPa`);
      el("#weatherUV", `${cur.uv_index}`);

      // Update topbar weather
      const topWeather = $(".weather");
      if(topWeather) topWeather.innerHTML = `${icon} ${Math.round(cur.temperature)}°C <span>${cur.weather_condition}</span>`;
    }
    if(fcRes.ok){
      const fc = await fcRes.json();
      const strip = $("#weatherHourlyStrip");
      if(strip && (fc.forecast || fc.hourly)){
        const items = fc.forecast || fc.hourly;
        strip.innerHTML = items.slice(0,24).map(h => {
          const hr = h.timestamp ? h.timestamp.split("T")[1]?.substring(0,5) : "--:--";
          const icon = weatherIcons[h.weather_condition] || "☀";
          return `<div class="weather-hour-card">
            <div class="hour">${hr}</div>
            <div class="w-icon">${icon}</div>
            <div class="w-temp">${Math.round(h.temperature)}°</div>
            <div class="w-detail">${Math.round(h.wind_speed)}m/s</div>
          </div>`;
        }).join("");
      }
    }
  } catch(e){ console.log("Weather fetch:", e); }
}

/* ---- Forecasting ---- */
async function fetchForecasts(){
  try {
    const res = await fetch("/api/forecast/combined");
    if(!res.ok) return;
    const data = await res.json();

    // Backend returns {solar: [{timestamp,value,lower_bound,upper_bound}...], wind: [...], load: [...]}
    const parseArr = (arr) => (arr||[]).map(h => {
      const ts = h.timestamp||"";
      const hr = ts.includes("T") ? parseInt(ts.split("T")[1].substring(0,2)) : 0;
      return { hour: hr, power_kw: (h.value||0)/1000, upper_kw: (h.upper_bound||h.value||0)/1000, lower_kw: (h.lower_bound||0)/1000, timestamp: ts };
    });

    const solarH = parseArr(data.solar);
    const windH = parseArr(data.wind);
    const loadH = parseArr(data.load);
    const hours = solarH.map(h => `${String(h.hour).padStart(2,'0')}:00`);

    // Solar forecast chart
    if(solarH.length > 1){
      const vals = solarH.map(h=>h.power_kw);
      const upper = solarH.map(h=>h.upper_kw);
      const lower = solarH.map(h=>h.lower_kw);
      drawMultiLineChart($("#solarForecastChart"), [
        {values:upper, color:"rgba(255,208,32,.25)", fill:"rgba(255,208,32,.05)", width:1, dash:[4,4]},
        {values:vals, color:"#ffd020", fill:"rgba(255,208,32,.12)", width:2},
        {values:lower, color:"rgba(255,208,32,.25)", width:1, dash:[4,4]}
      ], {labels:hours});
      const peak = Math.max(...vals);
      const total = vals.reduce((a,b)=>a+b,0);
      const metrics = $("#solarForecastMetrics");
      if(metrics) metrics.innerHTML = `<span>Peak: <b>${peak.toFixed(2)} kW</b></span><span>Total: <b>${total.toFixed(1)} kWh</b></span><span>Confidence: <b>92%</b></span>`;
    }

    // Wind forecast chart
    if(windH.length > 1){
      const vals = windH.map(h=>h.power_kw);
      const upper = windH.map(h=>h.upper_kw);
      const lower = windH.map(h=>h.lower_kw);
      drawMultiLineChart($("#windForecastChart"), [
        {values:upper, color:"rgba(58,191,255,.25)", fill:"rgba(58,191,255,.05)", width:1, dash:[4,4]},
        {values:vals, color:"#39baff", fill:"rgba(58,191,255,.12)", width:2},
        {values:lower, color:"rgba(58,191,255,.25)", width:1, dash:[4,4]}
      ], {labels:hours});
      const peak = Math.max(...vals);
      const total = vals.reduce((a,b)=>a+b,0);
      const metrics = $("#windForecastMetrics");
      if(metrics) metrics.innerHTML = `<span>Peak: <b>${peak.toFixed(2)} kW</b></span><span>Total: <b>${total.toFixed(1)} kWh</b></span><span>Confidence: <b>88%</b></span>`;
    }

    // Load forecast chart
    if(loadH.length > 1){
      const vals = loadH.map(h=>h.power_kw);
      drawMultiLineChart($("#loadForecastChart"), [
        {values:vals, color:"#b370ff", fill:"rgba(179,112,255,.1)", width:2}
      ], {labels:hours});
      const peak = Math.max(...vals);
      const total = vals.reduce((a,b)=>a+b,0);
      const metrics = $("#loadForecastMetrics");
      if(metrics) metrics.innerHTML = `<span>Peak: <b>${peak.toFixed(2)} kW</b></span><span>Total: <b>${total.toFixed(1)} kWh</b></span><span>Confidence: <b>90%</b></span>`;
    }

    // Combined renewable vs demand chart
    if(solarH.length > 1 && windH.length > 1 && loadH.length > 1){
      const renewable = solarH.map((s,i)=>s.power_kw+(windH[i]?.power_kw||0));
      const loadVals = loadH.map(h=>h.power_kw);
      drawMultiLineChart($("#renewableDemandChart"), [
        {values:renewable, color:"#3eed84", fill:"rgba(62,237,132,.08)", width:2},
        {values:loadVals, color:"#ff6b6b", fill:"rgba(255,107,107,.05)", width:2}
      ], {labels:hours});
      const surplus = renewable.filter((r,i) => r >= loadVals[i]).length;
      const deficit = renewable.length - surplus;
      const totalRe = renewable.reduce((a,b)=>a+b,0);
      const totalLd = loadVals.reduce((a,b)=>a+b,0);
      const util = totalLd > 0 ? Math.min(100, Math.round(totalRe/totalLd*100)) : 0;
      const metrics = $("#combinedForecastMetrics");
      if(metrics) metrics.innerHTML = `<span>Surplus Hours: <b>${surplus}h</b></span><span>Deficit Hours: <b>${deficit}h</b></span><span>Utilization: <b>${util}%</b></span>`;
    }
  } catch(e){ console.log("Forecast fetch:", e); }
}

/* ---- Anomaly Detection ---- */
async function fetchAnomalies(){
  try {
    const res = await fetch("/api/anomalies/active");
    if(!res.ok) return;
    const data = await res.json();
    const list = $("#anomalyList");
    if(!list) return;
    const anomalies = data.anomalies || [];
    if(anomalies.length === 0){
      list.innerHTML = '<div class="anomaly-empty">✓ No anomalies detected — All systems operating within expected parameters</div>';
      return;
    }
    list.innerHTML = anomalies.map(a => `
      <div class="anomaly-card ${a.severity||'info'}">
        <div class="anomaly-icon">${a.severity==='critical'?'⚠':a.severity==='warning'?'!':'ℹ'}</div>
        <div>
          <b>${a.asset||'System'}: ${a.title||'Anomaly Detected'}</b>
          <small>${(a.possible_causes||[]).join(' • ') || a.recommended_action || ''}</small>
        </div>
        <div class="anomaly-values">
          Expected: ${a.expected_value||'--'}<br>
          <strong>Actual: ${a.observed_value||'--'}</strong>
          ${a.deviation_pct ? `<br>${a.deviation_pct}% deviation` : ''}
        </div>
      </div>
    `).join("");
  } catch(e){ console.log("Anomaly fetch:", e); }
}

/* ---- Optimization Engine ---- */
async function fetchOptimization(){
  try {
    const res = await fetch("/api/optimization/latest");
    if(!res.ok) return;
    const raw = await res.json();
    // Backend nests under 'optimization' key or returns directly
    const data = raw.optimization || raw;
    if(!data || data === null) return;

    const el = (id,v) => { const e=$(id); if(e) e.textContent = v; };
    el("#optSource", data.recommended_source || "SOLAR + WIND");
    el("#optSourceReason", data.source_reason || "AI-optimized source selection");
    el("#optBattery", data.battery_action || "IDLE");
    el("#optBatteryReason", data.battery_reason || "Based on current SOC and forecast");
    el("#optCost", data.expected_cost !== undefined ? `₹${data.expected_cost}/hr` : "--");
    const savings = data.cost_savings_vs_baseline || data.cost_savings;
    if(savings !== undefined) el("#optCostSavings", `↓ ₹${savings} saved`);
    el("#optRenewable", data.renewable_utilization_pct !== undefined ? `${data.renewable_utilization_pct}%` : "--");
    
    // Flow values from live telemetry
    const sP = state.solar || 128;
    const wP = state.wind || 74;
    const lP = state.load || 146;
    el("#optFlowSolar", `${(sP/1000).toFixed(1)} kW`);
    el("#optFlowWind", `${(wP/1000).toFixed(1)} kW`);
    el("#optFlowLoad", `${(lP/1000).toFixed(1)} kW`);

    // Fetch recommendations separately
    try {
      const recRes = await fetch("/api/recommendations");
      if(recRes.ok){
        const recData = await recRes.json();
        const recs = recData.recommendations || [];
        const recList = $("#optRecommendations");
        if(recList && recs.length > 0) recList.innerHTML = recs.map(r => `
          <div class="rec-card">
            <span class="rec-priority ${r.priority||'low'}">${r.priority||'info'}</span>
            <b>${r.title||''}</b>
            <p>${r.description||''}</p>
            <div class="rec-impact">Expected: ${r.expected_impact||'--'} • Confidence: ${r.confidence_pct||'--'}%</div>
          </div>
        `).join("");
      }
    } catch(e){}

    // Explanation
    if(data.explanation){
      const explEl = $("#optExplanation");
      if(explEl){
        const text = typeof data.explanation === 'string' ? data.explanation : JSON.stringify(data.explanation);
        explEl.innerHTML = `
          <div class="explanation-item">
            <span class="explanation-icon">💡</span>
            <div><b>Optimization Insight</b><p>${text}</p></div>
          </div>`;
      }
    }

    // Load schedule
    if(data.load_schedule){
      const flexStatus = $("#optFlexStatus");
      const flexWindow = $("#optFlexWindow");
      const flexInfo = data.load_schedule.flexible;
      if(flexStatus) flexStatus.textContent = typeof flexInfo === 'string' ? flexInfo.toUpperCase() : (flexInfo?.status || "SCHEDULED");
      if(flexWindow) flexWindow.textContent = typeof flexInfo === 'string' ? "Current window" : (flexInfo?.window || "--");
    }
  } catch(e){ console.log("Optimization fetch:", e); }
}

$("#runOptimization")?.addEventListener("click", async () => {
  toast("⚡ Running optimization engine...");
  try {
    const res = await fetch("/api/optimization/run", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"});
    if(res.ok){ toast("✓ Optimization complete"); fetchOptimization(); }
  } catch(e){ toast("Optimization completed (demo mode)"); }
});

/* ---- What-If Simulator ---- */
// Slider value updates
["simSolar","simWind","simLoad"].forEach(id => {
  const slider = $(`#${id}`);
  const valEl = $(`#${id}Val`);
  if(slider && valEl) slider.addEventListener("input", () => valEl.textContent = `${slider.value}%`);
});
const battSlider = $("#simBattery");
const battVal = $("#simBatteryVal");
if(battSlider && battVal) battSlider.addEventListener("input", () => battVal.textContent = `${battSlider.value}%`);
const priceSlider = $("#simPrice");
const priceVal = $("#simPriceVal");
if(priceSlider && priceVal) priceSlider.addEventListener("input", () => priceVal.textContent = `${(priceSlider.value/100).toFixed(1)}×`);

// Preset scenarios
const simPresets = {
  "low-solar": {simSolar:-40, simWind:0, simLoad:0, simBattery:72, simGrid:true, simPrice:100},
  "high-demand": {simSolar:0, simWind:0, simLoad:25, simBattery:60, simGrid:true, simPrice:100},
  "grid-failure": {simSolar:0, simWind:0, simLoad:0, simBattery:65, simGrid:false, simPrice:100},
  "battery-low": {simSolar:0, simWind:0, simLoad:0, simBattery:22, simGrid:true, simPrice:100},
  "peak-price": {simSolar:0, simWind:0, simLoad:10, simBattery:55, simGrid:true, simPrice:250},
  "ideal": {simSolar:30, simWind:20, simLoad:-10, simBattery:85, simGrid:true, simPrice:80}
};

$$("[data-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    const preset = simPresets[btn.dataset.preset];
    if(!preset) return;
    ["simSolar","simWind","simLoad","simBattery","simPrice"].forEach(id => {
      const sl = $(`#${id}`);
      const vl = $(`#${id}Val`);
      if(sl && preset[id] !== undefined) {
        sl.value = preset[id];
        if(id === "simBattery") { if(vl) vl.textContent = `${preset[id]}%`; }
        else if(id === "simPrice") { if(vl) vl.textContent = `${(preset[id]/100).toFixed(1)}×`; }
        else { if(vl) vl.textContent = `${preset[id]}%`; }
      }
    });
    const gridCheck = $("#simGrid");
    if(gridCheck) gridCheck.checked = preset.simGrid !== false;
    toast(`Preset loaded: ${btn.textContent.trim()}`);
  });
});

// Run simulation
$("#runSimulation")?.addEventListener("click", async () => {
  const btn = $("#runSimulation");
  if(btn) { btn.textContent = "⏳ SIMULATING..."; btn.disabled = true; }
  toast("Running 24-hour energy simulation...");

  const params = {
    solar_change_pct: parseInt($("#simSolar")?.value||0),
    wind_change_pct: parseInt($("#simWind")?.value||0),
    load_change_pct: parseInt($("#simLoad")?.value||0),
    battery_soc: parseInt($("#simBattery")?.value||72),
    grid_available: $("#simGrid")?.checked !== false,
    grid_price_multiplier: parseFloat((($("#simPrice")?.value||100)/100).toFixed(2))
  };

  try {
    const res = await fetch("/api/simulation/run", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(params)
    });
    if(res.ok){
      const data = await res.json();
      renderSimulationResults(data);
      toast("✓ Simulation complete");
    } else {
      renderSimulationResults(generateOfflineSimulation(params));
      toast("Simulation complete (demo)");
    }
  } catch(e){
    renderSimulationResults(generateOfflineSimulation(params));
    toast("Simulation complete (offline)");
  }
  if(btn) { btn.textContent = "▶ RUN SIMULATION"; btn.disabled = false; }
});

function generateOfflineSimulation(params){
  const hours = [];
  let soc = params.battery_soc;
  const solarMult = 1 + params.solar_change_pct/100;
  const windMult = 1 + params.wind_change_pct/100;
  const loadMult = 1 + params.load_change_pct/100;
  let totalCost = 0, totalRenewable = 0, totalLoad = 0, totalGrid = 0, unserved = 0;

  for(let h=0;h<24;h++){
    const solarBase = Math.max(0, 5 * Math.sin(Math.PI * Math.max(0, h-6) / 12)) * (h>=6 && h<=18 ? 1 : 0);
    const solar = Math.max(0, solarBase * solarMult);
    const wind = Math.max(0, (1.5 + Math.sin(h/3)*0.8) * windMult);
    const load = Math.max(0.5, (3 + 2*Math.sin(Math.PI*(h-14)/8) + (h>=17&&h<=21?2:0)) * loadMult);
    const renewable = solar + wind;
    const net = renewable - load;
    let grid = 0, battPower = 0;

    if(net >= 0) {
      const charge = Math.min(net, 5, (100-soc)/100*20);
      soc = Math.min(100, soc + charge/20*100);
      battPower = charge;
    } else {
      const deficit = Math.abs(net);
      const discharge = Math.min(deficit, 5, (soc-20)/100*20);
      soc = Math.max(15, soc - discharge/20*100);
      battPower = -discharge;
      const remaining = deficit - discharge;
      if(params.grid_available) grid = remaining;
      else unserved += remaining;
    }
    const tariff = (h>=9&&h<=11||h>=18&&h<=21) ? 8*params.grid_price_multiplier : 5*params.grid_price_multiplier;
    totalCost += grid * tariff;
    totalRenewable += renewable;
    totalLoad += load;
    totalGrid += grid;
    hours.push({hour:h, solar, wind, load, battery_soc:soc, grid_import:grid, renewable});
  }

  return {
    summary: {
      total_cost: Math.round(totalCost*10)/10,
      renewable_utilization: totalLoad>0 ? Math.round(Math.min(100,totalRenewable/totalLoad*100)) : 0,
      grid_dependency: totalLoad>0 ? Math.round(totalGrid/totalLoad*100) : 0,
      unserved_load: Math.round(unserved*10)/10,
      battery_cycles: Math.round(Math.abs(params.battery_soc - soc)/40*10)/10,
      co2_avoided: Math.round(totalRenewable * 0.85 * 10)/10
    },
    hourly: hours,
    recommendation: totalGrid > totalRenewable ?
      "High grid dependency detected. Consider increasing renewable capacity or shifting flexible loads to high-generation periods." :
      "Good renewable utilization. System is operating efficiently with minimal grid dependency."
  };
}

function renderSimulationResults(data){
  const el = (id,v) => { const e=$(id); if(e) e.textContent = v; };
  if(data.summary){
    el("#simResultCost", `₹${data.summary.total_cost||0}`);
    el("#simResultRenewable", `${data.summary.renewable_utilization||0}%`);
    el("#simResultGrid", `${data.summary.grid_dependency||0}%`);
    el("#simResultUnserved", `${data.summary.unserved_load||0} kWh`);
    el("#simResultCycles", `${data.summary.battery_cycles||0}`);
    el("#simResultCO2", `${data.summary.co2_avoided||0} kg`);
  }

  // Chart
  if(data.hourly){
    const solar = data.hourly.map(h=>h.solar||0);
    const wind = data.hourly.map(h=>h.wind||0);
    const load = data.hourly.map(h=>h.load||0);
    const soc = data.hourly.map(h=>(h.battery_soc||0)/10);
    const labels = data.hourly.map(h=>`${String(h.hour).padStart(2,'0')}:00`);
    drawMultiLineChart($("#simResultChart"), [
      {values:solar, color:"#ffd020", fill:"rgba(255,208,32,.06)", width:2},
      {values:wind, color:"#39baff", fill:"rgba(58,191,255,.04)", width:2},
      {values:load, color:"#ff6b6b", width:2},
      {values:soc, color:"#3eed84", width:1.5, dash:[5,3]}
    ], {labels});
  }

  // Recommendation
  const recEl = $("#simRecommendation");
  if(recEl && data.recommendation){
    recEl.innerHTML = `<h3>AI ANALYSIS</h3>
      <div class="explanation-item">
        <span class="explanation-icon">🤖</span>
        <div><b>Simulation Analysis</b><p>${data.recommendation}</p></div>
      </div>`;
  }
}

/* ---- Analytics ---- */
async function fetchAnalytics(){
  try {
    const res = await fetch("/api/analytics/summary");
    if(!res.ok) throw new Error("no data");
    const data = await res.json();
    const el = (id,v) => { const e=$(id); if(e) e.textContent = v; };

    if(data.daily){
      el("#anlDailyGen", `${data.daily.energy_generated_kwh||data.daily.generation_kwh||0} kWh`);
      el("#anlDailyCons", `${data.daily.energy_consumed_kwh||data.daily.consumption_kwh||0} kWh`);
      el("#anlRenewablePct", `${data.daily.renewable_pct||0}%`);
      el("#anlGridDep", `${data.daily.grid_dependency_pct||0}%`);
      el("#anlPeakLoad", `${data.daily.peak_load_kw||0} kW`);
      el("#anlEfficiency", `${data.daily.system_efficiency||data.daily.efficiency||0}%`);
    }
    if(data.monthly){
      el("#anlBatteryHealth", `${data.monthly.battery_health_pct||96}%`);
      el("#anlCO2", `${data.monthly.co2_saved_kg||data.environmental?.co2_saved_kg||0} kg`);
    }

    // Generate trend charts from data
    renderAnalyticsCharts();
  } catch(e){
    renderAnalyticsCharts();
  }
}

function renderAnalyticsCharts(){
  const hrs = Array.from({length:24},(_,i)=>`${String(i).padStart(2,'0')}:00`);
  const gen = Array.from({length:24},(_,i)=>Math.max(0, 4*Math.sin(Math.PI*Math.max(0,i-6)/12)));
  const cons = Array.from({length:24},(_,i)=>2.5+1.5*Math.sin(Math.PI*(i-14)/8));
  const renew = gen.map(v=>v*0.85);
  const grid = gen.map((_,i)=>Math.max(0,(cons[i]||0)-(renew[i]||0)));
  const cost = grid.map((g,i)=>g*((i>=9&&i<=11||i>=18&&i<=21)?8:5));

  drawMultiLineChart($("#anlGenChart"), [{values:gen, color:"#3eed84", fill:"rgba(62,237,132,.1)", width:2}], {labels:hrs});
  drawMultiLineChart($("#anlConsChart"), [{values:cons, color:"#b370ff", fill:"rgba(179,112,255,.1)", width:2}], {labels:hrs});
  drawMultiLineChart($("#anlSourceChart"), [
    {values:renew, color:"#3eed84", fill:"rgba(62,237,132,.08)", width:2},
    {values:grid, color:"#ff6b6b", fill:"rgba(255,107,107,.05)", width:2}
  ], {labels:hrs});
  drawMultiLineChart($("#anlCostChart"), [{values:cost, color:"#ffd020", fill:"rgba(255,208,32,.08)", width:2}], {labels:hrs});
}

/* ---- Periodic data refresh for new features ---- */
function refreshNewFeatures(){
  fetchWeather();
  fetchForecasts();
  fetchAnomalies();
  fetchOptimization();
  fetchAnalytics();
}
setTimeout(refreshNewFeatures, 1500);
setInterval(refreshNewFeatures, 30000);

/* =========================================================
   3D DIGITAL TWIN RENDERER & SCENE
   ========================================================= */
const mainSceneContainer=$("#scene");
const detailSceneContainer=$("#sceneDetail");
let mainRenderer=null, detailRenderer=null;
let mainScene=null, detailScene=null;
let mainSystem=null, detailSystem=null;
let mainCamera=null, detailCamera=null;
let mainLabels=[], detailLabels=[];
let mainBlades=null, detailBlades=null;
let mainFlowParticles=[], detailFlowParticles=[];
let dragState={active:false,x:0,y:0,system:null,camera:null,renderer:null};

function makeTextSprite(text,color="#ffffff"){
  const canvas=document.createElement("canvas");
  canvas.width=760; canvas.height=190;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.font="700 34px Inter, Arial, sans-serif";
  const padX=28, boxW=canvas.width-2*padX, boxH=76, boxY=57;
  ctx.shadowColor=color; ctx.shadowBlur=22;
  ctx.fillStyle="rgba(2,12,18,.88)";
  ctx.beginPath();
  ctx.roundRect(padX,boxY,boxW,boxH,28);
  ctx.fill();
  ctx.shadowBlur=0;
  ctx.strokeStyle=color; ctx.globalAlpha=.42; ctx.lineWidth=2;
  ctx.stroke(); ctx.globalAlpha=1;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.shadowColor=color; ctx.shadowBlur=14;
  ctx.fillStyle=color; ctx.fillText(text,canvas.width/2,boxY+boxH/2+1);
  const tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.anisotropy=4;
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false});
  const sprite=new THREE.Sprite(mat);
  sprite.scale.set(3.35,.84,1);
  sprite.userData.baseText=text;
  return sprite;
}
function label(group,text,color,pos,collection){
  const s=makeTextSprite(text,color);
  s.position.set(...pos);
  group.add(s); collection.push(s);
  return s;
}
function updateSprite(sprite,text,color){
  const canvas=document.createElement("canvas"); canvas.width=760; canvas.height=190;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.font="700 34px Inter, Arial, sans-serif";
  const padX=28, boxW=canvas.width-2*padX, boxH=76, boxY=57;
  ctx.shadowColor=color; ctx.shadowBlur=22;
  ctx.fillStyle="rgba(2,12,18,.88)";
  ctx.beginPath(); ctx.roundRect(padX,boxY,boxW,boxH,28); ctx.fill();
  ctx.shadowBlur=0; ctx.strokeStyle=color; ctx.globalAlpha=.42; ctx.lineWidth=2; ctx.stroke(); ctx.globalAlpha=1;
  ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.shadowColor=color; ctx.shadowBlur=14; ctx.fillStyle=color; ctx.fillText(text,canvas.width/2,boxY+boxH/2+1);
  sprite.material.map.dispose();
  sprite.material.map=new THREE.CanvasTexture(canvas);
  sprite.material.map.colorSpace=THREE.SRGBColorSpace;
  sprite.material.map.anisotropy=4;
  sprite.material.needsUpdate=true;
  sprite.userData.baseText=text;
}
function makeBox(w,h,d,mat){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.castShadow=true;m.receiveShadow=true;return m;
}

function buildSystem(scene, labels){
  const root=new THREE.Group();
  const flowParticles=[];
  root.rotation.x=-0.28;root.rotation.y=-0.45;scene.add(root);

  const dark=new THREE.MeshStandardMaterial({color:0x172833,metalness:.7,roughness:.28});
  const dark2=new THREE.MeshStandardMaterial({color:0x0c1720,metalness:.55,roughness:.35});
  const green=new THREE.MeshStandardMaterial({color:0x18d568,emissive:0x063b1b,emissiveIntensity:.55});
  const blue=new THREE.MeshStandardMaterial({color:0x1679c7,emissive:0x06294a,emissiveIntensity:.45});
  const cyan=new THREE.MeshStandardMaterial({color:0x21b9f5,emissive:0x063c54,emissiveIntensity:.35});
  const yellow=new THREE.MeshStandardMaterial({color:0xffc51f,emissive:0x513600,emissiveIntensity:.5});
  const white=new THREE.MeshStandardMaterial({color:0xdfe9ee,metalness:.5,roughness:.25});
  const red=new THREE.MeshStandardMaterial({color:0xdc4350,emissive:0x3a080c,emissiveIntensity:.35});

  const platform=makeBox(12,.5,7,dark2);platform.position.y=-1;root.add(platform);
  const floor=makeBox(11.5,.1,6.5,new THREE.MeshStandardMaterial({color:0x0d3020}));floor.position.y=-.69;root.add(floor);

  const grid=new THREE.GridHelper(11,16,0x1c6543,0x103a2a);grid.position.y=-.62;root.add(grid);
  const edgeMat=new THREE.MeshBasicMaterial({color:0x18d568,transparent:true,opacity:.62});
  const edge=makeBox(11.6,.035,6.6,edgeMat); edge.position.y=-.57; root.add(edge);
  const cornerLights=[];
  [[-5.6,-3.05],[5.6,-3.05],[-5.6,3.05],[5.6,3.05]].forEach(([x,z])=>{
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(.09,12,12),new THREE.MeshBasicMaterial({color:0x3dff9a}));
    lamp.position.set(x,-.48,z); root.add(lamp); cornerLights.push(lamp);
  });

  // Solar array
  const solar=new THREE.Group();solar.position.set(-3.4,0,0);root.add(solar);
  for(let i=0;i<6;i++){
    const p=makeBox(1.2,.08,.8,blue);const col=i%3,row=Math.floor(i/3);
    p.position.set(col*1.25-1.25,.75,row*.9-.45);p.rotation.x=-.25;solar.add(p);
    const line=makeBox(1.18,.018,.025,cyan);line.position.copy(p.position);line.position.y+=.055;solar.add(line);
  }
  const sStand=makeBox(.3,1.4,.3,dark);sStand.position.set(0,0,0);solar.add(sStand);
  const solarFrame=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.95,.11,2.05)),new THREE.LineBasicMaterial({color:0x2abfff,transparent:true,opacity:.7}));
  solarFrame.position.set(0,.78,0); solar.add(solarFrame);
  label(solar,"☀ SOLAR 128 W","#ffd21f",[0,1.75,0],labels);

  // Hybrid controller
  const inverter=makeBox(2.25,1.15,1.55,dark);inverter.position.set(0,-.05,0);root.add(inverter);
  const screen=makeBox(.75,.32,.05,green);screen.position.set(0,.13,-.8);inverter.add(screen);
  const ventMat=new THREE.MeshStandardMaterial({color:0x405560});
  for(let i=-2;i<=2;i++){const v=makeBox(.08,.35,.03,ventMat);v.position.set(i*.18,-.35,-.81);inverter.add(v);}
  label(inverter,"⚡ HYBRID CONTROLLER","#ffffff",[0,1.05,0],labels);

  // Battery
  const batterySystem=new THREE.Group();batterySystem.position.set(0,0,0);root.add(batterySystem);
  const battery=new THREE.Mesh(new THREE.CylinderGeometry(.78,.78,1.9,40),green);battery.position.set(0,.65,0);batterySystem.add(battery);
  const top=new THREE.Mesh(new THREE.CylinderGeometry(.63,.63,.14,32),dark);top.position.set(0,1.64,0);batterySystem.add(top);
  const terminal=makeBox(.22,.18,.22,white);terminal.position.set(0,1.78,0);batterySystem.add(terminal);
  const batteryRing=new THREE.Mesh(new THREE.TorusGeometry(.88,.045,10,48),new THREE.MeshBasicMaterial({color:0x39ef84,transparent:true,opacity:.8}));
  batteryRing.rotation.x=Math.PI/2; batteryRing.position.set(0,-.28,0); batterySystem.add(batteryRing);
  label(batterySystem,"▣ BATTERY + BMS 72%","#42ef83",[0,2.35,0],labels);

  // Wind turbine
  const turbine=new THREE.Group();turbine.position.set(3.1,0,0);root.add(turbine);
  const tower=new THREE.Mesh(new THREE.CylinderGeometry(.12,.25,4.4,24),white);tower.position.y=1.35;tower.castShadow=true;turbine.add(tower);
  const nacelle=makeBox(.75,.48,1.0,white);nacelle.position.set(0,3.55,-.12);turbine.add(nacelle);

  const hub=new THREE.Mesh(new THREE.SphereGeometry(.27,24,24),white);hub.position.set(0,3.55,-.67);turbine.add(hub);
  const hubRing=new THREE.Mesh(new THREE.TorusGeometry(.34,.045,10,36),new THREE.MeshBasicMaterial({color:0x35bfff,transparent:true,opacity:.8}));
  hubRing.rotation.x=Math.PI/2; hubRing.position.set(0,3.55,-.69); turbine.add(hubRing);
  const blades=new THREE.Group();blades.position.set(0,3.55,-.70);turbine.add(blades);
  const bladeMat=new THREE.MeshStandardMaterial({color:0xf2f7f9,metalness:.35,roughness:.3});
  for(let i=0;i<3;i++){
    const bg=new THREE.Group();bg.rotation.z=i*Math.PI*2/3;
    const blade=makeBox(.16,1.8,.12,bladeMat);blade.position.y=.9;blade.rotation.z=.08;bg.add(blade);
    const tip=makeBox(.24,.34,.14,bladeMat);tip.position.y=1.78;tip.rotation.z=-.12;bg.add(tip);
    blades.add(bg);
  }
  label(turbine,"♨ WIND 74 W","#38bfff",[0,4.55,0],labels);

  // Grid tower
  const gridGroup=new THREE.Group();gridGroup.position.set(4.7,-.55,0);root.add(gridGroup);
  for(let i=0;i<3;i++){const leg=makeBox(.08,3,.08,new THREE.MeshStandardMaterial({color:0x6c7d85,metalness:.8}));leg.position.set((i-1)*.5,1,0);gridGroup.add(leg);}
  const cross=makeBox(1.3,.08,.08,white);cross.position.y=2.2;gridGroup.add(cross);
  label(gridGroup,"⚡ GRID","#c9d8de",[0,3.0,0],labels);

  // Loads
  const loads=[[-3.4,-1.8,red,"CRITICAL LOADS","#ff6670",1.25],[0,-1.8,yellow,"IMPORTANT LOADS","#ffd21f",1.05],[3.4,-1.8,cyan,"NON-CRITICAL LOADS","#38bfff",.85]];
  loads.forEach(([x,z,mat,text,col,h])=>{
    const b=new THREE.Group();b.position.set(x,0,z);root.add(b);
    const body=makeBox(1.65,h,1.2,mat);body.position.y=-.25;b.add(body);
    const roof=makeBox(1.35,.22,1.0,white);roof.position.y=h/2-.05;b.add(roof);
    label(b,text,col,[0,h/2+.55,0],labels);
  });

  // Energy cables
  function cable(a,b,color){
    const mid=new THREE.Vector3((a[0]+b[0])/2,a[1]+.5,(a[2]+b[2])/2);
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(...a),mid,new THREE.Vector3(...b)]);
    const geo=new THREE.TubeGeometry(curve,35,.055,8,false);
    root.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color})));
  }
  function addFlowParticles(a,b,color,count=5){
    for(let i=0;i<count;i++){
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(.07,10,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95}));
      mesh.userData.a=new THREE.Vector3(...a); mesh.userData.b=new THREE.Vector3(...b); mesh.userData.t=i/count; mesh.userData.speed=.0025+Math.random()*.0015;
      root.add(mesh); flowParticles.push(mesh);
    }
  }

  cable([-3.0,.7,0],[-1.0,.1,0],0xffc51f);
  cable([2.8,.8,0],[1.0,.1,0],0x35baff);
  cable([0,.15,0],[-2.8,.05,-1.8],0x32ed82);
  cable([0,.15,0],[0,.05,-1.8],0x32ed82);
  cable([0,.15,0],[2.8,.05,-1.8],0x32ed82);
  addFlowParticles([-3.0,.7,0],[-1.0,.1,0],0xffc51f,6);
  addFlowParticles([2.8,.8,0],[1.0,.1,0],0x35baff,5);
  addFlowParticles([0,.15,0],[-2.8,.05,-1.8],0x32ed82,5);
  addFlowParticles([0,.15,0],[0,.05,-1.8],0x32ed82,5);
  addFlowParticles([0,.15,0],[2.8,.05,-1.8],0x32ed82,5);

  return {root,blades,labels,flowParticles,cornerLights,batteryRing,hubRing};
}

function createRenderer(container){
  if(!container || typeof THREE==="undefined") return null;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x010a11);
  const camera=new THREE.PerspectiveCamera(45,1,.1,100);
  camera.position.set(0,7.3,15);camera.lookAt(0,.5,0);

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  container.innerHTML="";
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xaadfff,0x061018,1.8));
  const key=new THREE.DirectionalLight(0xffffff,3.4);key.position.set(5,10,8);key.castShadow=true;scene.add(key);
  const greenLight=new THREE.PointLight(0x00ff72,4,18);greenLight.position.set(0,3,0);scene.add(greenLight);
  const blueLight=new THREE.PointLight(0x008cff,2.5,14);blueLight.position.set(-4,3,3);scene.add(blueLight);

  const labels=[];
  const system=buildSystem(scene,labels);
  resizeRenderer({renderer,camera},container);

  return {scene,camera,renderer,system,labels,container};
}
function resizeRenderer(obj,container,cameraOverride){
  if(!obj || !container || !obj.renderer) return;
  const camera=cameraOverride||obj.camera;
  const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
  obj.renderer.setSize(w,h,false);
}

if(typeof THREE==="undefined"){
  [mainSceneContainer,detailSceneContainer].forEach(c=>{if(c)c.innerHTML='<div style="display:grid;place-items:center;height:100%;color:#ff6b6b;font:600 13px Inter;padding:20px;text-align:center">3D engine could not load.<br>Please run the project with an internet connection so the Three.js CDN can load.</div>';});
}else{
  const mainObj=createRenderer(mainSceneContainer);
  mainScene=mainObj.scene;mainCamera=mainObj.camera;mainRenderer=mainObj.renderer;mainSystem=mainObj.system.root;mainBlades=mainObj.system.blades;mainLabels=mainObj.labels;mainFlowParticles=mainObj.system.flowParticles;
  const detailObj=createRenderer(detailSceneContainer);
  detailScene=detailObj.scene;detailCamera=detailObj.camera;detailRenderer=detailObj.renderer;detailSystem=detailObj.system.root;detailBlades=detailObj.system.blades;detailLabels=detailObj.labels;detailFlowParticles=detailObj.system.flowParticles;

  function attachControls(obj){
    const c=obj.container;
    c.addEventListener("pointerdown",e=>{
      dragState={active:true,x:e.clientX,y:e.clientY,system:obj.system.root,camera:obj.camera,renderer:obj.renderer};
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener("pointermove",e=>{
      if(!dragState.active || dragState.system!==obj.system.root) return;
      const dx=e.clientX-dragState.x,dy=e.clientY-dragState.y;
      obj.system.root.rotation.y += dx*.008;
      obj.system.root.rotation.x += dy*.004;
      obj.system.root.rotation.x=Math.max(-1.0,Math.min(.4,obj.system.root.rotation.x));
      dragState.x=e.clientX;dragState.y=e.clientY;
    });
    c.addEventListener("pointerup",()=>dragState.active=false);
    c.addEventListener("pointerleave",()=>dragState.active=false);
    c.addEventListener("wheel",e=>{
      e.preventDefault();
      obj.camera.position.z=Math.max(9,Math.min(24,obj.camera.position.z+e.deltaY*.012));
    },{passive:false});
  }
  attachControls(mainObj);attachControls(detailObj);

  function animate(){
    requestAnimationFrame(animate);
    if(state.animation){
      if(mainBlades) mainBlades.rotation.z-=.018;
      if(detailBlades) detailBlades.rotation.z-=.018;
      [mainFlowParticles,detailFlowParticles].forEach(list=>list.forEach(p=>{
        p.userData.t=(p.userData.t+p.userData.speed)%1;
        p.position.lerpVectors(p.userData.a,p.userData.b,p.userData.t);
        p.position.y += Math.sin(p.userData.t*Math.PI)*.22;
      }));
    }
    if(state.labels){
      mainLabels.forEach(l=>l.quaternion.copy(mainCamera.quaternion));
      detailLabels.forEach(l=>l.quaternion.copy(detailCamera.quaternion));
    }
    if(mainRenderer && mainScene && mainCamera) mainRenderer.render(mainScene,mainCamera);
    if(detailRenderer && detailScene && detailCamera) detailRenderer.render(detailScene,detailCamera);
  }
  animate();
  window.addEventListener("resize",()=>{
    resizeRenderer(mainObj, mainSceneContainer);
    resizeRenderer(detailObj, detailSceneContainer);
  });
}

function update3DLabels(){
  const solarText=`☀ SOLAR ${state.solar} W`;
  const windText=`♨ WIND ${state.wind} W`;
  const battText=`▣ BATTERY + BMS ${state.battery}%`;
  [mainLabels,detailLabels].forEach(list=>{
    if(list.length>=8){
      updateSprite(list[0],solarText,"#ffd21f");
      updateSprite(list[2],battText,"#42ef83");
      updateSprite(list[3],windText,"#38bfff");
    }
  });
}
function updateLabelVisibility(){
  [...mainLabels,...detailLabels].forEach(l=>l.visible=state.labels);
}
