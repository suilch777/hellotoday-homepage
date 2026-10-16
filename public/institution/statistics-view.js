(function(root) {
  "use strict";
  const DAY = 86400000;
  const day = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
  function aggregate(records, startDate, endDate, targetCount) {
    const start = Date.parse(startDate + "T00:00:00+09:00"), end = Date.parse(endDate + "T00:00:00+09:00");
    if (!Number.isFinite(start) || !Number.isFinite(end) || day(start) !== startDate || day(end) !== endDate || start > end || end - start >= 366 * DAY)
      throw Error("조회 기간은 최대 1년이며 시작일과 종료일을 확인해 주세요.");
    const days = [];
    for (let at = start; at <= end; at += DAY) days.push({date: day(at), complete: 0, incomplete: 0, help: 0, delayed: 0});
    const dates = new Map(days.map(d => [d.date, d]));
    // Completed check-ins supersede reminders; active/history copies must count only once.
    const rows = root.InstitutionRecordsView.merge(records);
    const result = {targetCount, complete: 0, incomplete: 0, helpDone: 0, helpOpen: 0, helpExpired: 0, helpOther: 0, delayedDone: 0, delayedOpen: 0, days};
    for (const row of rows) {
      if (!Number.isFinite(row.occurredAtMs) || row.occurredAtMs < start || row.occurredAtMs >= end + DAY) continue;
      const bucket = dates.get(day(row.occurredAtMs));
      if (row.type === "CHECK_IN") { const key = row.status === "COMPLETED" ? "complete" : "incomplete"; result[key]++; bucket[key]++; }
      if (row.type === "HELP_REQUEST") {
        const key = row.status === "COMPLETED" ? "helpDone" : ["PENDING", "RESPONDING"].includes(row.status) ? "helpOpen" : row.status === "EXPIRED_24H" ? "helpExpired" : "helpOther";
        result[key]++; bucket.help++;
      }
      if (row.type === "DELAYED_CHECK_IN") { result[["COMPLETED", "HANDLED"].includes(row.status) ? "delayedDone" : "delayedOpen"]++; bucket.delayed++; }
    }
    result.rate = result.complete + result.incomplete ? Math.round(1000 * result.complete / (result.complete + result.incomplete)) / 10 : null;
    return result;
  }
  function csv(result, info) {
    const rows = [["기관명", info.name], ["조회 기간", info.start + " ~ " + info.end], ["조회 완료 시각", info.asOf],
      ["집계 기준", "현재 기관 제공 동의가 유지되는 대상자의 저장 기록 기준. 조회 중 기록 변경 가능."],
      ["현재 관리 대상자 수", result.targetCount], ["안부 완료", result.complete], ["안부 미완료", result.incomplete], ["안부 완료율(%)", result.rate ?? "기록 없음"],
      ["도움 요청 처리 완료", result.helpDone], ["도움 요청 미처리", result.helpOpen], ["도움 요청 자동 종료", result.helpExpired], ["도움 요청 기타 종료", result.helpOther],
      ["안부 지연 조치 완료", result.delayedDone], ["안부 지연 미처리", result.delayedOpen], [], ["날짜", "안부 완료", "안부 미완료", "도움 요청 발생", "안부 지연 발생"],
      ...result.days.map(d => [d.date, d.complete, d.incomplete, d.help, d.delayed])];
    // Neutralize spreadsheet formulas even inside quoted CSV cells.
    return "\uFEFF" + rows.map(row => row.map(value => '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  }
  function create({call, getTargets, getName, isActive, errorText, openRecords}) {
    const $ = id => document.getElementById(id);
    let generation = 0, targets = [], result = null, info = null;
    function clear() {
      generation++; result = null; info = null; targets = [];
      $("statsReport").hidden = true; $("statsExport").disabled = true; $("statsPrint").disabled = true;
      $("statsMessage").textContent = "";
      $("statsForm").querySelectorAll("input,select,button").forEach(el => el.disabled = false);
    }
    function preset() {
      const today = day(Date.now()), value = $("statsPeriod").value;
      if (value === "custom") return;
      $("statsEnd").value = today;
      $("statsStart").value = value === "today" ? today : value === "week" ? day(Date.now() - 6 * DAY) : today.slice(0, 8) + "01";
    }
    function open() { clear(); targets = getTargets(); preset(); load(); }
    function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
    function svg(tag, attrs) { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v)); return el; }
    function pie(id, title, values, donut) {
      const host = $(id); host.replaceChildren(node("h3", title));
      const total = values.reduce((s,v) => s + v[1], 0);
      if (!total) { host.append(node("p", "해당 기간 기록 없음", "stats-no-data")); return; }
      const chart = svg("svg", {viewBox:"0 0 220 220",role:"img","aria-label":title + ": " + values.map(v => v[0] + " " + v[1] + "건").join(", ")});
      let angle = -Math.PI / 2;
      values.forEach(([label, value, color]) => {
        if (!value) return;
        const next = angle + 2 * Math.PI * value / total;
        if (value === total) chart.append(svg("circle", {cx:110,cy:110,r:90,fill:color,stroke:"#ffffff","stroke-width":2}));
        else chart.append(svg("path", {d:`M110 110 L${110+90*Math.cos(angle)} ${110+90*Math.sin(angle)} A90 90 0 ${value/total>.5?1:0} 1 ${110+90*Math.cos(next)} ${110+90*Math.sin(next)} Z`,fill:color}));
        angle = next;
      });
      if (donut) {
        chart.append(svg("circle", {cx:110,cy:110,r:65,fill:"white"}));
        const text = svg("text", {x:110,y:116,"text-anchor":"middle","font-size":26,fill:"#173750","font-weight":700}); text.textContent = result.rate + "%"; chart.append(text);
      }
      host.append(chart);
      const legend = node("ul", undefined, "stats-legend");
      values.forEach(([label,value,color]) => { const li = node("li"); const dot = node("span", "", "stats-dot"); dot.style.backgroundColor=color; li.append(dot,node("span", `${label} ${value}건 (${Math.round(1000*value/total)/10}%)`)); legend.append(li); });
      host.append(legend);
    }
    function render() {
      const r = result;
      $("statsReportName").textContent = info.name + " · 기관 운영 통계";
      $("statsReportPeriod").textContent = info.start + " ~ " + info.end + " · 조회 완료 " + info.asOf;
      const cards = $("statsCards"); cards.replaceChildren();
      for (const [label,value,type,status] of [["현재 관리 대상자",r.targetCount+"명"],["안부 완료율",r.rate===null?"기록 없음":r.rate+"%"],["미처리 도움 요청",r.helpOpen+"건","HELP_REQUEST","OPEN"],["미처리 안부 지연",r.delayedOpen+"건","DELAYED_CHECK_IN","OPEN"]]) {
        const card = node(type?"button":"div",undefined,"stats-card"); if(type){card.type="button";card.onclick=()=>openRecords({startDate:info.start,endDate:info.end,recordType:type,status});}
        card.append(node("span",label),node("strong",value)); cards.append(card);
      }
      pie("statsCheckChart","안부 완료·미완료 비율",[["완료",r.complete,"#3b958b"],["미완료",r.incomplete,"#d5a25d"]],true);
      pie("statsHelpChart","도움 요청 처리 현황",[["처리 완료",r.helpDone,"#3b958b"],["미처리",r.helpOpen,"#d5a25d"],["자동 종료",r.helpExpired,"#97a6bc"],["기타 종료",r.helpOther,"#a396bd"]],false);
      $("statsDelaySummary").textContent = `안부 지연 총 ${r.delayedDone + r.delayedOpen}건 · 조치 완료 ${r.delayedDone}건 · 미처리 ${r.delayedOpen}건`;
      const chart = $("statsBars"); chart.replaceChildren();
      const max = Math.max(1,...r.days.flatMap(d=>[d.help,d.delayed]));
      for (const d of r.days) {
        const row = node("div",undefined,"stats-bar-row");row.append(node("span",d.date.slice(5)));
        for (const [key,label] of [["help","도움 요청"],["delayed","안부 지연"]]) { const cell=node("div",undefined,"stats-bar-cell");const bar=node("span",undefined,"stats-bar "+key);bar.style.width=(d[key]/max*100)+"%";cell.append(bar,node("span",d[key]+"건"));cell.setAttribute("aria-label",d.date+" "+label+" "+d[key]+"건");row.append(cell); }
        chart.append(row);
      }
      const body=$("statsRows");body.replaceChildren();
      r.days.forEach(d=>{const tr=node("tr");[d.date,d.complete,d.incomplete,d.help,d.delayed].forEach(v=>tr.append(node("td",String(v))));body.append(tr);});
      $("statsReport").hidden=false;$("statsExport").disabled=false;$("statsPrint").disabled=false;
    }
    async function load() {
      if (!isActive()) return;
      const own=++generation, startDate=$("statsStart").value,endDate=$("statsEnd").value;
      result=null;$("statsReport").hidden=true;$("statsExport").disabled=true;$("statsPrint").disabled=true;
      try { aggregate([],startDate,endDate,0); } catch(e) { $("statsMessage").textContent=e.message; return; }
      $("statsForm").querySelectorAll("input,select,button").forEach(el=>el.disabled=true);
      const current=()=>own===generation&&isActive();
      const entries=[];
      try {
        for(let offset=0;offset<targets.length;offset+=3) {
          if(!current())return;
          await Promise.all(targets.slice(offset,offset+3).map(async target=>{
            let after={},seen=new Set();
            do {
              if(!current())return;
              const page=await call("institutionListRecords",{workerUid:target.workerUids[0],seniorUid:target.uid,recordType:"ALL",startDate,endDate,recordAfter:after});
              if(!current())return;
              entries.push(...page.records);after=page.next;
              if(after){const key=JSON.stringify(after);if(seen.has(key))throw Error("기록 목록 위치가 반복되어 집계를 중단했습니다.");seen.add(key);}
            }while(after);
          }));
          if(current())$("statsMessage").textContent=`기록 집계 중 · 대상자 ${Math.min(offset+3,targets.length)}/${targets.length}명 확인`;
        }
        if(!current())return;
        result=aggregate(entries,startDate,endDate,targets.length);
        info={name:getName(),start:startDate,end:endDate,asOf:new Date().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})};
        render();$("statsMessage").textContent="전체 기록 집계 완료 · 미처리 항목의 숫자를 누르면 해당 기록을 볼 수 있습니다.";
      }catch(e){if(current()){$("statsMessage").textContent="통계를 집계하지 못했습니다. 다시 조회해 주세요. "+errorText(e);result=null;}}
      finally{if(current())$("statsForm").querySelectorAll("input,select,button").forEach(el=>el.disabled=false);}
    }
    $("statsForm").addEventListener("submit",e=>{e.preventDefault();load();});
    $("statsPeriod").addEventListener("change",preset);
    $("statsForm").querySelectorAll("input,select").forEach(el=>el.addEventListener("change",()=>{if(el.tagName==="INPUT")$("statsPeriod").value="custom";generation++;result=null;$("statsReport").hidden=true;$("statsExport").disabled=true;$("statsPrint").disabled=true;$("statsMessage").textContent="기간이 변경되었습니다. 통계 조회를 눌러 주세요.";}));
    $("statsExport").onclick=()=>{if(!result||!isActive())return;const url=URL.createObjectURL(new Blob([csv(result,info)],{type:"text/csv;charset=utf-8"}));const a=node("a");a.href=url;a.download=`기관통계_${info.start}_${info.end}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
    $("statsPrint").onclick=()=>{if(result&&isActive())window.print();};
    return {open,clear};
  }
  const api={aggregate,csv,create};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.InstitutionStatisticsView=api;
})(typeof window!=="undefined"?window:globalThis);
