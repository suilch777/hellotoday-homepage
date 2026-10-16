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
    result.helpTotal = result.helpDone + result.helpOpen + result.helpExpired + result.helpOther;
    result.delayedTotal = result.delayedDone + result.delayedOpen;
    result.rate = result.complete + result.incomplete ? Math.round(1000 * result.complete / (result.complete + result.incomplete)) / 10 : null;
    return result;
  }
  function csv(result, info) {
    const rows = [["기관명", info.name], ["조회 기간", info.start + " ~ " + info.end], ["조회 완료 시각", info.asOf],
      ["집계 기준", "현재 기관 제공 동의가 유지되는 대상자의 저장 기록 기준. 조회 중 기록 변경 가능."],
      ["현재 관리 대상자 수", result.targetCount], ["안부 완료", result.complete], ["안부 미완료", result.incomplete], ["안부 완료율(%)", result.rate ?? "기록 없음"],
      ["도움 요청 발생 건수", result.helpTotal],
      ["안부 지연 발생 건수", result.delayedTotal], [], ["날짜", "안부 완료", "안부 미완료", "도움 요청 발생", "안부 지연 발생"],
      ...result.days.map(d => [d.date, d.complete, d.incomplete, d.help, d.delayed])];
    // Neutralize spreadsheet formulas even inside quoted CSV cells.
    return "\uFEFF" + rows.map(row => row.map(value => '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  }
  function occurrenceBuckets(days) {
    const size = Math.max(1, Math.ceil(days.length / 7)), buckets = [];
    for (let i = 0; i < days.length; i += size) {
      const group = days.slice(i, i + size);
      buckets.push({label: group[0].date.slice(5) + (group.length > 1 ? "~" + group.at(-1).date.slice(5) : ""),
        help: group.reduce((n,d) => n + d.help, 0), delayed: group.reduce((n,d) => n + d.delayed, 0)});
    }
    return {size, buckets};
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
    function occurrenceChart(id, title, key, total, color, groups, scale) {
      const host = $(id); host.replaceChildren(node("h3",title),node("p",total + "건","stats-occurrence-total"));
      host.append(node("p", groups.size === 1 ? "날짜별 발생 건수" : groups.size + "일 단위 발생 건수 · 전체 날짜는 상세내역 참조", "stats-chart-caption"));
      if (!total) { host.append(node("p","해당 기간 발생 기록 없음","stats-no-data")); return; }
      const chart = svg("svg",{viewBox:"0 0 360 240",role:"img","aria-label":title+": "+groups.buckets.map(d=>d.label+" "+d[key]+"건").join(", ")});
      const width=310/groups.buckets.length;
      chart.append(svg("line",{x1:25,y1:190,x2:340,y2:190,stroke:"#dbe5e9"}));
      groups.buckets.forEach((d,i)=>{
        const x=25+i*width, height=d[key]/scale*145;
        chart.append(svg("rect",{x:x+width*.2,y:190-height,width:width*.6,height,rx:4,fill:color}));
        const count=svg("text",{x:x+width/2,y:180-height,"text-anchor":"middle","font-size":13,fill:"#173750"});count.textContent=d[key];chart.append(count);
        const label=svg("text",{x:x+width/2,y:208,"text-anchor":"end","font-size":10,fill:"#526575",transform:"rotate(-35 "+(x+width/2)+" 208)"});label.textContent=d.label;chart.append(label);
      });
      host.append(chart);
    }
    function render() {
      const r = result;
      $("statsReportName").textContent = info.name + " · 기관 운영 통계";
      $("statsReportPeriod").textContent = info.start + " ~ " + info.end + " · 조회 완료 " + info.asOf;
      const cards = $("statsCards"); cards.replaceChildren();
      for (const [label,value,type,status] of [["현재 관리 대상자",r.targetCount+"명"],["안부 완료율",r.rate===null?"기록 없음":r.rate+"%"],["도움 요청 발생",r.helpTotal+"건","HELP_REQUEST","ALL"],["안부 지연 발생",r.delayedTotal+"건","DELAYED_CHECK_IN","ALL"]]) {
        const card = node(type?"button":"div",undefined,"stats-card"); if(type){card.type="button";card.onclick=()=>openRecords({startDate:info.start,endDate:info.end,recordType:type,status});}
        card.append(node("span",label),node("strong",value)); cards.append(card);
      }
      pie("statsCheckChart","안부 완료·미완료 비율",[["완료",r.complete,"#3b958b"],["미완료",r.incomplete,"#d5a25d"]],true);
      const groups = occurrenceBuckets(r.days), scale = Math.max(1,...groups.buckets.flatMap(d=>[d.help,d.delayed]));
      occurrenceChart("statsHelpChart","도움 요청 발생 건수","help",r.helpTotal,"#6b8fbd",groups,scale);
      occurrenceChart("statsDelayChart","안부 지연 발생 건수","delayed",r.delayedTotal,"#d5a25d",groups,scale);
      $("statsDetailsName").textContent = info.name + " · 날짜별 상세내역";
      $("statsDetailsPeriod").textContent = $("statsReportPeriod").textContent;
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
        render();$("statsMessage").textContent="전체 기록 집계 완료 · 발생 건수 숫자를 누르면 해당 기간의 전체 기록을 볼 수 있습니다.";
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
  const api={aggregate,csv,occurrenceBuckets,create};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.InstitutionStatisticsView=api;
})(typeof window!=="undefined"?window:globalThis);
