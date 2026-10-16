import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const PALETTE = [
  { bg:"#DBEAFE", text:"#1E40AF", border:"#93C5FD", light:"#EFF6FF" },
  { bg:"#D1FAE5", text:"#065F46", border:"#6EE7B7", light:"#ECFDF5" },
  { bg:"#FEF3C7", text:"#92400E", border:"#FCD34D", light:"#FFFBEB" },
  { bg:"#EDE9FE", text:"#4C1D95", border:"#C4B5FD", light:"#F5F3FF" },
  { bg:"#FFE4E6", text:"#9F1239", border:"#FCA5A5", light:"#FFF1F2" },
  { bg:"#CFFAFE", text:"#164E63", border:"#67E8F9", light:"#ECFEFF" },
];
const DEFAULT_PEOPLE = ["Alice","Bob","Carol","David"];
const DEFAULT_COMPANIES = [
  { name:"Acme Corp", pay:500 },
  { name:"Globex", pay:750 },
  { name:"Initech", pay:600 },
];
const DOC_ID = "shared"; // single shared document for all users

const TODAY = new Date();
const CY = TODAY.getFullYear(), CM = TODAY.getMonth(), CD = TODAY.getDate();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getDIM = (m, y) => new Date(y, m + 1, 0).getDate();
const getDayIdx = (y, m, d) => { const r = new Date(y,m,d).getDay(); return r===0?6:r-1; };
const dKey = (y, m, d, s) => `${y}-${m+1}-${d}__${s}`;
const isToday = (y, m, d) => y===CY && m===CM && d===CD;
const fmt = n => "₹"+n.toLocaleString("en-IN");
const clr = (name, companies) => { const i = companies.findIndex(c=>c.name===name); return PALETTE[i>=0?i%PALETTE.length:0]; };
const clrIdx = i => PALETTE[i%PALETTE.length];

// ─── Sub-components ───────────────────────────────────────────────────────────
const Tag = ({ col, children, onRemove }) => (
  <span style={{ display:"inline-flex", alignItems:"center", gap:3, background:col.bg, color:col.text, border:`1px solid ${col.border}`, borderRadius:20, padding:"3px 10px", fontSize:12, fontWeight:500, userSelect:"none" }}>
    {children}
    {onRemove && <button onClick={e=>{e.stopPropagation();onRemove();}} style={{ background:"none", border:"none", cursor:"pointer", color:col.text, padding:"0 0 0 2px", fontSize:14, lineHeight:1, opacity:0.6 }} aria-label="Remove">×</button>}
  </span>
);

const StatCard = ({ label, value, sub, col }) => (
  <div style={{ background:col?col.light:"#F8FAFC", border:`1px solid ${col?col.border:"#E2E8F0"}`, borderRadius:12, padding:"14px 16px" }}>
    <p style={{ margin:0, fontSize:11, fontWeight:600, color:col?col.text:"#64748B", textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</p>
    <p style={{ margin:"6px 0 0", fontSize:22, fontWeight:700, color:col?col.text:"#0F172A" }}>{value}</p>
    {sub && <p style={{ margin:"2px 0 0", fontSize:11, color:col?col.text:"#94A3B8", opacity:0.8 }}>{sub}</p>}
  </div>
);

const navBtnStyle = { background:"#F1F5F9", border:"1px solid #E2E8F0", borderRadius:8, padding:"5px 12px", cursor:"pointer", fontSize:15, color:"#475569", fontWeight:700, lineHeight:1 };

const NavRow = ({ prev, next, label }) => (
  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
    <button onClick={prev} aria-label="Previous" style={navBtnStyle}>‹</button>
    <span style={{ fontSize:14, fontWeight:600, minWidth:150, textAlign:"center", color:"#0F172A" }}>{label}</span>
    <button onClick={next} aria-label="Next" style={navBtnStyle}>›</button>
  </div>
);

const Badge = ({ col, label }) => (
  <span style={{ background:col.bg, color:col.text, border:`1px solid ${col.border}`, borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>{label}</span>
);

const StatusBadge = ({ worked, isWeekend }) => {
  if (worked) return <span style={{ background:"#DCFCE7", color:"#166534", border:"1px solid #86EFAC", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }}>Present</span>;
  if (isWeekend) return <span style={{ background:"#F1F5F9", color:"#94A3B8", borderRadius:6, padding:"2px 8px", fontSize:11 }}>Weekend</span>;
  return <span style={{ background:"#FEF2F2", color:"#DC2626", border:"1px solid #FECACA", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:500 }}>Absent</span>;
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [loaded, setLoaded]       = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [people, setPeople]       = useState(DEFAULT_PEOPLE);
  const [companies, setCompanies] = useState(DEFAULT_COMPANIES);
  const [assignments, setAssign]  = useState({});
  const [newPerson, setNewPerson] = useState("");
  const [newCo, setNewCo]         = useState("");
  const [newPay, setNewPay]       = useState("");
  const [editPay, setEditPay]     = useState(null);
  const [view, setView]           = useState("scheduler");
  const [selPerson, setSelPerson] = useState(null);
  const [viewYear, setViewYear]   = useState(CY);
  const [exMonth, setExMonth]     = useState(CM);
  const [sYear, setSYear]         = useState(CY);
  const [sMonth, setSMonth]       = useState(CM);
  const [openCell, setOpenCell]   = useState(null);
  const dropdownRef               = useRef(null);
  const isSyncing                 = useRef(false); // prevent echo writes

  // ── Firestore real-time listener ──
  useEffect(() => {
    const ref = doc(db, "scheduler", DOC_ID);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (!isSyncing.current) {
          if (data.people)      setPeople(data.people);
          if (data.companies)   setCompanies(data.companies);
          if (data.assignments) setAssign(data.assignments);
        }
      }
      setLoaded(true);
    }, () => setLoaded(true));
    return () => unsub();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpenCell(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Persist to Firestore ──
  const persist = useCallback(async (p, c, a) => {
    setSyncing(true);
    isSyncing.current = true;
    try {
      await setDoc(doc(db, "scheduler", DOC_ID), { people: p, companies: c, assignments: a });
    } catch (e) { console.error("Sync error:", e); }
    isSyncing.current = false;
    setSyncing(false);
  }, []);

  const payOf = useCallback((name) => (companies.find(c=>c.name===name)||{}).pay||0, [companies]);

  // ── Data accessors ──
  const getA = (person,y,m,d,s) => (assignments[person]||{})[dKey(y,m,d,s)]||null;

  const setA = useCallback((person,y,m,d,shift,company) => {
    const key = dKey(y,m,d,shift);
    setAssign(prev => {
      const pd = {...(prev[person]||{})};
      if (!company||pd[key]===company) delete pd[key]; else pd[key]=company;
      const next = {...prev,[person]:pd};
      persist(people, companies, next);
      return next;
    });
    setOpenCell(null);
  }, [people, companies, persist]);

  // ── Mutations ──
  const addPerson = useCallback(() => {
    const n = newPerson.trim();
    if (!n||people.includes(n)) return;
    const next = [...people,n]; setPeople(next); persist(next,companies,assignments); setNewPerson("");
  }, [newPerson, people, companies, assignments, persist]);

  const addCompany = useCallback(() => {
    const n = newCo.trim(), p = parseFloat(newPay)||0;
    if (!n||companies.find(c=>c.name===n)) return;
    const next = [...companies,{name:n,pay:p}]; setCompanies(next); persist(people,next,assignments); setNewCo(""); setNewPay("");
  }, [newCo, newPay, companies, people, assignments, persist]);

  const removePerson = useCallback((name) => {
    const np = people.filter(x=>x!==name);
    const na = {...assignments}; delete na[name];
    setPeople(np); setAssign(na); persist(np,companies,na);
    if (selPerson===name) { setSelPerson(null); setView("scheduler"); }
  }, [people, assignments, companies, selPerson, persist]);

  const removeCompany = useCallback((name) => {
    const nc = companies.filter(c=>c.name!==name);
    const na = {};
    Object.entries(assignments).forEach(([p,data]) => {
      na[p]={}; Object.entries(data).forEach(([k,v])=>{ if(v!==name) na[p][k]=v; });
    });
    setCompanies(nc); setAssign(na); persist(people,nc,na);
  }, [companies, assignments, people, persist]);

  const saveEditPay = useCallback(() => {
    if (!editPay) return;
    const nc = companies.map(c=>c.name===editPay.name?{...c,pay:parseFloat(editPay.value)||0}:c);
    setCompanies(nc); persist(people,nc,assignments); setEditPay(null);
  }, [editPay, companies, people, assignments, persist]);

  const reset = () => {
    if (!window.confirm("Reset all data to defaults?")) return;
    setPeople(DEFAULT_PEOPLE); setCompanies(DEFAULT_COMPANIES); setAssign({});
    persist(DEFAULT_PEOPLE,DEFAULT_COMPANIES,{});
  };

  const openAttendance = (p) => { setSelPerson(p); setViewYear(sYear); setExMonth(sMonth); setView("attendance"); };
  const prevMonth = () => { if(sMonth===0){setSMonth(11);setSYear(y=>y-1);}else setSMonth(m=>m-1); };
  const nextMonth = () => { if(sMonth===11){setSMonth(0);setSYear(y=>y+1);}else setSMonth(m=>m+1); };

  // ── Year data ──
  const yearData = useMemo(() => {
    if (!selPerson) return [];
    return Array.from({length:12},(_,m) => {
      const rows = Array.from({length:getDIM(m,viewYear)},(_,i)=>{
        const d=i+1, di=getDayIdx(viewYear,m,d), isWE=di>=5;
        const ds=getA(selPerson,viewYear,m,d,"Day"), ns=getA(selPerson,viewYear,m,d,"Night");
        const earned=(ds?payOf(ds):0)+(ns?payOf(ns):0);
        return {date:d,dayName:DAYS[di],isWeekend:isWE,dayShift:ds,nightShift:ns,earned};
      });
      const workedDays=rows.filter(r=>r.dayShift||r.nightShift).length;
      const totalShifts=rows.reduce((a,r)=>a+(r.dayShift?1:0)+(r.nightShift?1:0),0);
      const totalEarned=rows.reduce((a,r)=>a+r.earned,0);
      const cs={};
      rows.forEach(({dayShift:ds,nightShift:ns})=>{
        if(ds){cs[ds]=cs[ds]||{shifts:0,pay:0};cs[ds].shifts++;cs[ds].pay+=payOf(ds);}
        if(ns){cs[ns]=cs[ns]||{shifts:0,pay:0};cs[ns].shifts++;cs[ns].pay+=payOf(ns);}
      });
      return {month:m,rows,workedDays,totalShifts,totalEarned,companyStats:cs};
    });
  }, [selPerson, viewYear, assignments, companies]);

  const yearTotals = useMemo(() => {
    const t={workedDays:0,totalShifts:0,totalEarned:0,companyStats:{}};
    yearData.forEach(({workedDays:wd,totalShifts:ts,totalEarned:te,companyStats:cs})=>{
      t.workedDays+=wd; t.totalShifts+=ts; t.totalEarned+=te;
      Object.entries(cs).forEach(([c,{shifts,pay}])=>{
        t.companyStats[c]=t.companyStats[c]||{shifts:0,pay:0};
        t.companyStats[c].shifts+=shifts; t.companyStats[c].pay+=pay;
      });
    });
    return t;
  }, [yearData]);

  const schedDays = useMemo(() => Array.from({length:getDIM(sMonth,sYear)},(_,i)=>i+1), [sMonth,sYear]);

  // ── Sync indicator ──
  const SyncPill = () => (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, padding:"4px 12px", borderRadius:20, fontWeight:600, background: syncing?"#FEF3C7":"#DCFCE7", color: syncing?"#92400E":"#166534", border: `1px solid ${syncing?"#FCD34D":"#86EFAC"}`, transition:"all .3s" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background: syncing?"#F59E0B":"#22C55E", display:"inline-block", animation: syncing?"pulse 1s infinite":"none" }} />
      {syncing ? "Syncing…" : "Live"}
    </span>
  );

  const inp = (extra={}) => ({ fontSize:13, padding:"7px 10px", borderRadius:8, border:"1px solid #E2E8F0", background:"#fff", color:"#0F172A", outline:"none", boxSizing:"border-box", ...extra });

  // ── Loading screen ──
  if (!loaded) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"system-ui,sans-serif",background:"#F8FAFC"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>📋</div>
        <p style={{margin:0,fontSize:15,fontWeight:600,color:"#0F172A"}}>Staff Scheduler</p>
        <p style={{margin:"6px 0 0",fontSize:13,color:"#64748B"}}>Connecting to database…</p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════
  // SCHEDULER VIEW
  // ═══════════════════════════════════════════════════════════
  if (view==="scheduler") return (
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",color:"#0F172A",minHeight:"100vh",background:"#F8FAFC"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #E2E8F0",padding:"14px 20px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",position:"sticky",top:0,zIndex:50,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
          <div style={{background:"linear-gradient(135deg,#3B82F6,#6366F1)",borderRadius:10,padding:"7px 9px",fontSize:18,lineHeight:1}}>📋</div>
          <div>
            <h1 style={{margin:0,fontSize:16,fontWeight:700}}>Staff Scheduler</h1>
            <p style={{margin:0,fontSize:11,color:"#64748B"}}>{MONTHS[sMonth]} {sYear}</p>
          </div>
        </div>
        <SyncPill />
        <button onClick={reset} style={{fontSize:11,padding:"5px 12px",borderRadius:8,border:"1px solid #E2E8F0",background:"#F8FAFC",cursor:"pointer",color:"#94A3B8",fontWeight:500}}>Reset</button>
      </div>

      <div style={{padding:"16px 20px",maxWidth:1400,margin:"0 auto"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:20}}>

          {/* People */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <span style={{fontSize:16}}>👥</span>
              <h2 style={{margin:0,fontSize:14,fontWeight:600}}>People</h2>
              <span style={{marginLeft:"auto",background:"#EFF6FF",color:"#3B82F6",borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:600}}>{people.length}</span>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10,minHeight:32}}>
              {people.map(p => (
                <Tag key={p} col={{bg:"#F1F5F9",text:"#334155",border:"#E2E8F0"}} onRemove={()=>removePerson(p)}>
                  <button onClick={()=>openAttendance(p)} style={{background:"none",border:"none",cursor:"pointer",color:"#3B82F6",padding:0,fontSize:12,fontWeight:600}}>{p}</button>
                </Tag>
              ))}
            </div>
            <div style={{display:"flex",gap:6}}>
              <input value={newPerson} onChange={e=>setNewPerson(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPerson()} placeholder="Name…" style={inp({flex:1,width:"auto"})} />
              <button onClick={addPerson} style={{padding:"7px 14px",borderRadius:8,border:"none",background:"#3B82F6",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,whiteSpace:"nowrap"}}>+ Add</button>
            </div>
          </div>

          {/* Companies */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <span style={{fontSize:16}}>🏢</span>
              <h2 style={{margin:0,fontSize:14,fontWeight:600}}>Companies</h2>
              <span style={{marginLeft:"auto",background:"#F0FDF4",color:"#16A34A",borderRadius:20,padding:"1px 8px",fontSize:11,fontWeight:600}}>{companies.length}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
              {companies.map((c,i) => {
                const col=clrIdx(i), isE=editPay?.name===c.name;
                return (
                  <div key={c.name} style={{display:"flex",alignItems:"center",gap:8,background:col.light,border:`1px solid ${col.border}`,borderRadius:10,padding:"7px 10px"}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:col.text,flexShrink:0}} />
                    <span style={{flex:1,fontSize:13,fontWeight:600,color:col.text}}>{c.name}</span>
                    {isE ? (
                      <div style={{display:"flex",gap:4,alignItems:"center"}}>
                        <span style={{fontSize:12,color:col.text}}>₹</span>
                        <input value={editPay.value} onChange={e=>setEditPay({...editPay,value:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")saveEditPay();if(e.key==="Escape")setEditPay(null);}}
                          style={{width:65,fontSize:12,padding:"3px 6px",borderRadius:6,border:`1px solid ${col.border}`,textAlign:"right",outline:"none"}} autoFocus />
                        <button onClick={saveEditPay} style={{background:col.bg,border:"none",cursor:"pointer",color:col.text,fontWeight:700,borderRadius:5,padding:"2px 6px",fontSize:12}}>✓</button>
                        <button onClick={()=>setEditPay(null)} style={{background:"none",border:"none",cursor:"pointer",color:col.text,opacity:0.5,fontSize:14}}>✕</button>
                      </div>
                    ) : (
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:12,color:col.text,fontWeight:500,background:col.bg,borderRadius:6,padding:"2px 8px"}}>{fmt(c.pay)}/shift</span>
                        <button onClick={()=>setEditPay({name:c.name,value:String(c.pay)})} style={{background:"none",border:"none",cursor:"pointer",color:col.text,opacity:0.5,fontSize:13,padding:2}}>✎</button>
                        <button onClick={()=>removeCompany(c.name)} style={{background:"none",border:"none",cursor:"pointer",color:col.text,opacity:0.4,fontSize:15,padding:2}}>×</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:5}}>
              <input value={newCo} onChange={e=>setNewCo(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCompany()} placeholder="Company…" style={inp({flex:2,width:"auto"})} />
              <input value={newPay} onChange={e=>setNewPay(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCompany()} placeholder="₹/shift" type="number" style={inp({flex:1,width:"auto",minWidth:0})} />
              <button onClick={addCompany} style={{padding:"7px 12px",borderRadius:8,border:"none",background:"#16A34A",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,whiteSpace:"nowrap"}}>+ Add</button>
            </div>
          </div>
        </div>

        {/* Month nav */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
          <NavRow prev={prevMonth} next={nextMonth} label={`${MONTHS[sMonth]} ${sYear}`} />
          <p style={{margin:0,fontSize:12,color:"#94A3B8"}}>Click <strong>+</strong> to assign · Click name for attendance</p>
        </div>

        {/* Grid */}
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div style={{overflowX:"auto"}} ref={dropdownRef}>
            <table style={{borderCollapse:"collapse",width:"100%",minWidth:500}}>
              <thead>
                <tr style={{background:"#F8FAFC"}}>
                  <th style={{padding:"10px 14px",fontSize:11,fontWeight:700,color:"#64748B",textAlign:"left",border:"1px solid #F1F5F9",textTransform:"uppercase",letterSpacing:"0.05em",width:70}}>Date</th>
                  <th style={{padding:"10px 8px",fontSize:11,fontWeight:700,color:"#64748B",textAlign:"center",border:"1px solid #F1F5F9",textTransform:"uppercase",letterSpacing:"0.05em",width:44}}>Day</th>
                  {people.map(p => (
                    <th key={p} colSpan={2} style={{padding:"10px 8px",fontSize:12,fontWeight:700,color:"#1E40AF",textAlign:"center",border:"1px solid #F1F5F9",background:"#EFF6FF"}}>
                      <button onClick={()=>openAttendance(p)} style={{background:"none",border:"none",cursor:"pointer",color:"#1E40AF",fontSize:12,fontWeight:700,padding:0,textDecoration:"underline",textDecorationStyle:"dotted"}}>{p}</button>
                    </th>
                  ))}
                </tr>
                <tr style={{background:"#F8FAFC"}}>
                  <th style={{border:"1px solid #F1F5F9"}} /><th style={{border:"1px solid #F1F5F9"}} />
                  {people.map(p => ["Day","Night"].map(s => (
                    <th key={`${p}-${s}`} style={{padding:"5px 4px",fontSize:10,fontWeight:600,color:"#94A3B8",textAlign:"center",border:"1px solid #F1F5F9",whiteSpace:"nowrap",background:s==="Night"?"#FAFAF9":"#F8FAFC"}}>
                      {s==="Day"?"☀️":"🌙"} {s}
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {schedDays.map(d => {
                  const di=getDayIdx(sYear,sMonth,d), dn=DAYS[di], isWE=di>=5, tod=isToday(sYear,sMonth,d);
                  return (
                    <tr key={d} style={{background:tod?"#EFF6FF":isWE?"#FAFAF9":"#fff",borderBottom:"1px solid #F1F5F9"}}>
                      <td style={{padding:"6px 14px",fontSize:12,fontWeight:tod?700:500,color:tod?"#1D4ED8":"#374151",whiteSpace:"nowrap",borderRight:"1px solid #F1F5F9"}}>
                        {d}{tod&&<span style={{marginLeft:4,fontSize:8,background:"#3B82F6",color:"#fff",borderRadius:10,padding:"1px 5px",verticalAlign:"middle",fontWeight:700}}>TODAY</span>}
                      </td>
                      <td style={{padding:"6px 4px",fontSize:11,fontWeight:500,color:isWE?"#94A3B8":"#6B7280",textAlign:"center",borderRight:"1px solid #F1F5F9"}}>{dn}</td>
                      {people.map(person => ["Day","Night"].map(shift => {
                        const assigned=getA(person,sYear,sMonth,d,shift);
                        const col=assigned?clr(assigned,companies):null;
                        const key=`${person}__${dKey(sYear,sMonth,d,shift)}`;
                        const isOpen=openCell===key;
                        return (
                          <td key={key} style={{padding:3,textAlign:"center",position:"relative",verticalAlign:"middle",background:shift==="Night"?"rgba(15,23,42,0.02)":"transparent",borderRight:"1px solid #F1F5F9"}}>
                            <button onClick={()=>setOpenCell(isOpen?null:key)}
                              style={{width:"100%",minHeight:28,minWidth:52,borderRadius:8,border:assigned?`1.5px solid ${col.border}`:"1.5px dashed #CBD5E1",background:assigned?col.bg:"transparent",cursor:"pointer",padding:"2px 4px",fontSize:10,color:assigned?col.text:"#CBD5E1",fontWeight:assigned?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",transition:"all .15s"}}
                              aria-label={assigned?`${person} at ${assigned}`:`Assign ${person}`}>
                              {assigned?(assigned.length>8?assigned.slice(0,7)+"…":assigned):"+"}
                            </button>
                            {isOpen && (
                              <div style={{position:"absolute",zIndex:200,top:"calc(100% + 4px)",left:"50%",transform:"translateX(-50%)",background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,padding:8,minWidth:180,boxShadow:"0 10px 25px rgba(0,0,0,0.12)",textAlign:"left"}}>
                                <p style={{margin:"0 0 6px",fontSize:11,fontWeight:600,color:"#94A3B8",padding:"0 4px",textTransform:"uppercase",letterSpacing:"0.05em"}}>{shift==="Day"?"☀️":"🌙"} {shift} · {d} {MONTHS_SHORT[sMonth]}</p>
                                {companies.map((c,i)=>{ const bc=clrIdx(i); const isSel=assigned===c.name; return (
                                  <button key={c.name} onClick={()=>setA(person,sYear,sMonth,d,shift,c.name)}
                                    style={{display:"flex",width:"100%",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",marginBottom:3,borderRadius:8,border:isSel?`1.5px solid ${bc.border}`:"1px solid transparent",background:isSel?bc.bg:"transparent",cursor:"pointer",fontSize:12,color:isSel?bc.text:"#374151",fontWeight:isSel?600:400}}>
                                    <span>{c.name}</span>
                                    <span style={{fontSize:11,opacity:0.7,fontWeight:500}}>{fmt(c.pay)}</span>
                                  </button>
                                );})}
                                {assigned && <button onClick={()=>setA(person,sYear,sMonth,d,shift,null)} style={{display:"block",width:"100%",textAlign:"left",padding:"6px 10px",borderRadius:8,border:"1px solid #FEE2E2",background:"#FFF5F5",cursor:"pointer",fontSize:12,color:"#DC2626",fontWeight:500,marginTop:4}}>✕ Clear</button>}
                              </div>
                            )}
                          </td>
                        );
                      }))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════
  // ATTENDANCE VIEW
  // ═══════════════════════════════════════════════════════════
  return (
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",color:"#0F172A",minHeight:"100vh",background:"#F8FAFC"}}>
      <div style={{background:"#fff",borderBottom:"1px solid #E2E8F0",padding:"14px 20px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",position:"sticky",top:0,zIndex:50,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <button onClick={()=>setView("scheduler")} style={{display:"flex",alignItems:"center",gap:6,background:"#F1F5F9",border:"1px solid #E2E8F0",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:13,color:"#475569",fontWeight:600}}>← Back</button>
        <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
          <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#3B82F6,#6366F1)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:15,flexShrink:0}}>
            {selPerson?.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 style={{margin:0,fontSize:16,fontWeight:700}}>{selPerson}</h1>
            <p style={{margin:0,fontSize:11,color:"#64748B"}}>Attendance · {viewYear}</p>
          </div>
        </div>
        <SyncPill />
        <NavRow prev={()=>setViewYear(y=>y-1)} next={()=>setViewYear(y=>y+1)} label={String(viewYear)} />
      </div>

      <div style={{padding:"16px 20px",maxWidth:1200,margin:"0 auto"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:20}}>
          <StatCard label="Days Worked" value={yearTotals.workedDays} />
          <StatCard label="Total Shifts" value={yearTotals.totalShifts} />
          <StatCard label="Total Earnings" value={fmt(yearTotals.totalEarned)} col={{bg:"#DCFCE7",text:"#166534",border:"#86EFAC",light:"#F0FDF4"}} />
          {Object.entries(yearTotals.companyStats).map(([company,{shifts,pay}]) => {
            const col=clr(company,companies);
            return <StatCard key={company} label={company} value={fmt(pay)} sub={`${shifts} shifts`} col={col} />;
          })}
        </div>

        <h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.05em"}}>Monthly Overview</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:20}}>
          {yearData.map(({month,workedDays,totalShifts,totalEarned,companyStats}) => (
            <button key={month} onClick={()=>setExMonth(exMonth===month?null:month)}
              style={{background:exMonth===month?"#EFF6FF":"#fff",border:`1.5px solid ${exMonth===month?"#3B82F6":"#E2E8F0"}`,borderRadius:10,padding:"10px 8px",cursor:"pointer",textAlign:"left",transition:"all .15s",boxShadow:exMonth===month?"0 0 0 3px rgba(59,130,246,0.1)":"none"}}>
              <p style={{margin:0,fontSize:12,fontWeight:700,color:exMonth===month?"#1D4ED8":"#374151"}}>{MONTHS_SHORT[month]}</p>
              <p style={{margin:"3px 0 0",fontSize:10,color:"#94A3B8"}}>{workedDays}d · {totalShifts}s</p>
              <p style={{margin:"3px 0 0",fontSize:12,fontWeight:700,color:totalEarned>0?"#166534":"#CBD5E1"}}>{totalEarned>0?fmt(totalEarned):"—"}</p>
              <div style={{display:"flex",gap:3,marginTop:5,flexWrap:"wrap"}}>
                {Object.entries(companyStats).map(([c,{shifts}])=>{ const col=clr(c,companies); return <span key={c} style={{fontSize:9,background:col.bg,color:col.text,borderRadius:4,padding:"1px 5px",fontWeight:700}}>{shifts}</span>; })}
              </div>
            </button>
          ))}
        </div>

        {exMonth!==null && (()=>{
          const {month,rows,workedDays,totalShifts,totalEarned,companyStats}=yearData[exMonth];
          return (
            <div style={{background:"#fff",borderRadius:14,border:"1px solid #E2E8F0",overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <div style={{padding:"14px 16px",borderBottom:"1px solid #F1F5F9",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,background:"#F8FAFC"}}>
                <h3 style={{margin:0,fontSize:15,fontWeight:700}}>{MONTHS[month]} {viewYear}</h3>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontSize:12,color:"#64748B",fontWeight:500}}>{workedDays} days · {totalShifts} shifts</span>
                  <span style={{fontSize:12,fontWeight:700,color:"#166534",background:"#DCFCE7",border:"1px solid #86EFAC",borderRadius:8,padding:"3px 10px"}}>{fmt(totalEarned)}</span>
                  {Object.entries(companyStats).map(([c,{shifts,pay}])=>{ const col=clr(c,companies); return <span key={c} style={{fontSize:11,background:col.bg,color:col.text,border:`1px solid ${col.border}`,borderRadius:8,padding:"3px 8px",fontWeight:600}}>{c}: {shifts}s · {fmt(pay)}</span>; })}
                </div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{background:"#F8FAFC"}}>
                      {["Date","Day","☀️ Day Shift","🌙 Night Shift","Earned","Status"].map(h=>(
                        <th key={h} style={{padding:"9px 12px",fontSize:11,fontWeight:700,color:"#64748B",textAlign:h==="Date"||h==="Day"?"left":"center",border:"1px solid #F1F5F9",textTransform:"uppercase",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({date,dayName,isWeekend,dayShift,nightShift,earned})=>{
                      const worked=dayShift||nightShift, tod=isToday(viewYear,month,date);
                      const dci=dayShift?companies.findIndex(c=>c.name===dayShift):-1;
                      const nci=nightShift?companies.findIndex(c=>c.name===nightShift):-1;
                      return (
                        <tr key={date} style={{background:tod?"#EFF6FF":isWeekend?"#FAFAF9":"#fff",borderBottom:"1px solid #F1F5F9"}}>
                          <td style={{padding:"7px 12px",fontSize:12,fontWeight:tod?700:500,color:tod?"#1D4ED8":"#374151",whiteSpace:"nowrap"}}>
                            {date}{tod&&<span style={{marginLeft:5,fontSize:8,background:"#3B82F6",color:"#fff",borderRadius:10,padding:"1px 5px",verticalAlign:"middle",fontWeight:700}}>TODAY</span>}
                          </td>
                          <td style={{padding:"7px 12px",fontSize:11,fontWeight:500,color:isWeekend?"#94A3B8":"#6B7280"}}>{dayName}</td>
                          <td style={{padding:"7px 12px",textAlign:"center"}}>
                            {dayShift?<Badge col={clrIdx(dci)} label={dayShift}/>:<span style={{color:"#CBD5E1",fontSize:13}}>—</span>}
                          </td>
                          <td style={{padding:"7px 12px",textAlign:"center",background:"rgba(15,23,42,0.01)"}}>
                            {nightShift?<Badge col={clrIdx(nci)} label={nightShift}/>:<span style={{color:"#CBD5E1",fontSize:13}}>—</span>}
                          </td>
                          <td style={{padding:"7px 12px",textAlign:"center",fontWeight:earned>0?700:400,fontSize:12,color:earned>0?"#166534":"#CBD5E1"}}>
                            {earned>0?fmt(earned):"—"}
                          </td>
                          <td style={{padding:"7px 12px",textAlign:"center"}}>
                            <StatusBadge worked={worked} isWeekend={isWeekend} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}