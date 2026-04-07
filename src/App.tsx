/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { 
  FileText, 
  Check, 
  Download, 
  Upload, 
  Zap,
  ArrowLeftRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DB, LENGTHS, RAW, SERIES, ORIG_TAKEOFF } from './data';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const LO = 0.80;
const HI = 0.95;

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  column: { label: 'Column', icon: <FileText className="w-4 h-4" />, color: 'var(--color-amb)' },
  rafter: { label: 'Rafter', icon: <FileText className="w-4 h-4" />, color: 'var(--color-pur)' },
  beam: { label: 'Beam', icon: <FileText className="w-4 h-4" />, color: 'var(--color-blu)' },
  purlin: { label: 'Purlin', icon: <FileText className="w-4 h-4" />, color: 'var(--color-cyn)' },
  brace: { label: 'Brace/PIP', icon: <FileText className="w-4 h-4" />, color: '#e67e22' },
  tension: { label: 'Tension Rod', icon: <FileText className="w-4 h-4" />, color: 'var(--color-grn)' },
};

function detectType(sec: string): string {
  const s = sec.toUpperCase();
  if (s.startsWith('UC') || s.startsWith('W14') || s.startsWith('W12') || s.startsWith('W10') || s.startsWith('W8') || s.startsWith('SHS') || s.startsWith('HEA') || s.startsWith('HEB') || s.startsWith('HEM')) return 'column';
  if (s.startsWith('UB') || s.startsWith('W') || s.startsWith('ASB') || s.startsWith('RSJ') || s.startsWith('PFC') || s.startsWith('IPE')) {
    const d = DB[sec];
    if (d && d.m > 30) return 'rafter';
    return 'beam';
  }
  if (s.startsWith('PIP') || s.startsWith('CHS') || s.startsWith('HSS') || s.startsWith('PIPE') || s.startsWith('RHS') || s.startsWith('UNP')) return 'brace';
  if (s.startsWith('RD') || s.startsWith('ROD') || /^L\d/.test(s) || s.startsWith('EA') || s.startsWith('UA')) return 'tension';
  return 'purlin';
}

function getLen(id: number, sec?: string, lengths?: Record<number, number>): number {
  if (lengths && lengths[id]) return lengths[id];
  if (LENGTHS[id]) return LENGTHS[id];
  // Heuristic based on section if unknown
  if (sec?.startsWith('UC')) return 4.0;
  if (sec?.startsWith('UB')) return 6.0;
  return 3.0;
}

function getSeriesForSec(sec: string): string[] {
  const cleanSec = sec.toUpperCase().replace(/\s+/g, '').replace(/[×*]/g, 'X');
  
  // 1. Find the specific series it belongs to
  let currentSeries: string[] | null = null;
  for (const v of Object.values(SERIES)) {
    if (v.includes(cleanSec)) {
      currentSeries = v;
      break;
    }
  }
  
  // 2. Broad category matching for structural shapes (UB, UC, IPE, HEA, etc.)
  // This allows optimization to jump between serial sizes (e.g. UC356 to UC203)
  const type = cleanSec.replace(/[0-9.X-]+/g, '');
  
  if (type === 'UB') {
    const all = [SERIES.UB_102, SERIES.UB_133, SERIES.UB_146, SERIES.UB_171, SERIES.UB_178, SERIES.UB_LARGE];
    if (currentSeries) {
      const idx = all.indexOf(currentSeries);
      if (idx !== -1) {
        const start = Math.max(0, idx - 2);
        const end = Math.min(all.length - 1, idx + 2);
        const res: string[] = [];
        for (let i = start; i <= end; i++) res.push(...all[i]);
        return res;
      }
    }
    return all.flat();
  }
  if (type === 'UC') {
    const all = [SERIES.UC_152, SERIES.UC_203, SERIES.UC_254, SERIES.UC_305, SERIES.UC_356];
    if (currentSeries) {
      const idx = all.indexOf(currentSeries);
      if (idx !== -1) {
        const start = Math.max(0, idx - 2);
        const end = Math.min(all.length - 1, idx + 2);
        const res: string[] = [];
        for (let i = start; i <= end; i++) res.push(...all[i]);
        return res;
      }
    }
    return all.flat();
  }
  if (type === 'IPE') return SERIES.IPE;
  if (type === 'HEA') return SERIES.HEA;
  if (type === 'HEB') return SERIES.HEB;
  if (type === 'PFC') return SERIES.PFC;
  if (type === 'PIP' || type === 'CHS') return [...SERIES.PIP, ...SERIES.CHS];
  
  // 3. Fallback: Try to find a key in SERIES that is a prefix of cleanSec
  if (currentSeries) return currentSeries;
  
  return [];
}

function scaleUC(baseSec: string, baseUC: number, targetSec: string, type: string): number | null {
  const b = DB[baseSec];
  const t = DB[targetSec];
  if (!b || !t) return null;
  
  // For axial-dominant members (columns, braces, tension rods), scale by Area (A)
  // For bending-dominant members (beams, rafters, purlins), scale by Section Modulus (Zx)
  if (type === 'tension' || type === 'brace' || type === 'column') {
    const propB = b.A || b.Zx || b.Ix || 1;
    const propT = t.A || t.Zx || t.Ix || 1;
    return +(baseUC * propB / propT).toFixed(3);
  }
  
  const propB = b.Zx || b.Ix || b.A || 1;
  const propT = t.Zx || t.Ix || t.A || 1;
  return +(baseUC * propB / propT).toFixed(3);
}

function memberTonnes(sec: string, id: number, lengths?: Record<number, number>): number {
  const d = DB[sec];
  if (!d) return 0;
  return (d.m * getLen(id, sec, lengths)) / 1000;
}

const kN2t = (kn: number) => kn / 9.81;

function ucColor(uc: number) {
  return uc > 1.0 ? 'var(--color-red)' : uc >= HI ? 'var(--color-cyn)' : uc >= LO ? 'var(--color-grn)' : 'var(--color-amb)';
}

function ucBarCls(uc: number) {
  return uc > 1.0 ? 'bg-red' : uc >= HI ? 'bg-cyn' : uc >= LO ? 'bg-grn' : 'bg-amb';
}

function ucTextCls(uc: number) {
  return uc > 1.0 ? 'text-red' : uc >= HI ? 'text-cyn' : uc >= LO ? 'text-grn' : 'text-amb';
}

interface MemberOption {
  sec: string;
  uc: number | null;
  m: number;
  inBand: boolean;
  passes: boolean;
  isStaad: boolean;
}

interface Member {
  id: number;
  origSec: string;
  origUC: number;
  origPass: boolean;
  staadSec: string;
  staadUC: number;
  FX: number;
  MZ: number;
  cond: string;
  lc: number;
  type: string;
  options: MemberOption[];
  recommended: string;
  maxUCSection: string;
  chosen: string;
}

export default function App() {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [fType, setFType] = useState('all');
  const [fUC, setFUC] = useState('all');
  const [fSec, setFSec] = useState('all');
  const [activeTab, setActiveTab] = useState('suggestions');
  const [showOriginal, setShowOriginal] = useState(false);
  const [fileName, setFileName] = useState('No file uploaded');
  const [uploadStatus, setUploadStatus] = useState<{ msg: string; cls: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedMember, setExpandedMember] = useState<number | null>(null);

  const [origTakeoff, setOrigTakeoff] = useState(ORIG_TAKEOFF);
  const [memberLengths, setMemberLengths] = useState<Record<number, number>>({});

  const origTotalKN = useMemo(() => origTakeoff.reduce((s, r) => s + r.wkN, 0), [origTakeoff]);
  const origTotalTon = useMemo(() => kN2t(origTotalKN), [origTotalKN]);

  // Initialize members from RAW data
  useEffect(() => {
    const initialMembers = RAW.map(r => {
      const [id, origSec, origUC, origPass, staadSec, staadUC, FX, MZ, cond, lc] = r;
      const type = detectType(origSec);
      const series = getSeriesForSec(staadSec);

      const options = series.map(sec => {
        const uc = scaleUC(staadSec, staadUC, sec, type);
        const d = DB[sec];
        return {
          sec,
          uc,
          m: d ? d.m : 0,
          inBand: uc !== null && uc >= LO && uc <= HI,
          passes: uc !== null && uc <= 1.0,
          isStaad: sec === staadSec
        };
      }).filter(o => o.uc !== null && o.m !== null).sort((a, b) => a.m - b.m);

      const inBand = options.filter(o => o.inBand);
      const maxUCSection = options.find(o => o.passes)?.sec || staadSec;
      const recommended = inBand.length > 0 ? inBand[0].sec
        : (options.find(o => o.passes)?.sec || staadSec);

      return {
        id, origSec, origUC, origPass, staadSec, staadUC, FX, MZ, cond, lc, type, options,
        recommended, maxUCSection, chosen: recommended
      };
    });
    setMembers(initialMembers);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const processFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    setUploadStatus({ msg: 'Processing...', cls: 'amb' });
    try {
      let text = '';
      if (ext === 'pdf') {
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          
          // Improved text extraction to preserve lines
          let lastY: number | undefined;
          let pageText = '';
          for (const item of content.items as any[]) {
            if (lastY !== undefined && Math.abs(item.transform[5] - lastY) > (item.height || 5) * 0.5) {
              pageText += '\n';
            }
            pageText += item.str;
            lastY = item.transform[5];
          }
          text += pageText + '\n';
        }
        setUploadStatus({ msg: `✓ PDF parsed (${pdf.numPages} pages)`, cls: 'grn' });
      } else {
        text = await file.text();
        setUploadStatus({ msg: '✓ Loaded', cls: 'grn' });
      }
      setFileName(file.name);
      parsePDFText(text);
    } catch (e: any) {
      setUploadStatus({ msg: 'Parse failed: ' + e.message, cls: 'red' });
    }
  };

  const parsePDFText = (text: string) => {
    const lines = text.split(/\n/);
    
    // 1. Parse Member Properties (Original Sections)
    const memberProps: Record<number, string> = {};
    let inProps = false;
    const propRegex = /(?:^|\s)(\d+)\s+(?:TO|AND)\s+(\d+).+?(?:TABLE\s+)?ST\s+([A-Z0-9X.×/\\-]+)/i;
    const singlePropRegex = /(?:^|\s)(\d+)\s+(?:TABLE\s+)?ST\s+([A-Z0-9X.×/\\-]+)/i;

    // 2. Parse Member Selection (STAAD Results)
    const results: Record<number, { sec: string; result: string; uc: number; lc: number; cond: string; FX: number; MZ: number }> = {};
    let inSelect = false;
    // More flexible regex for member selection
    const selectRegex = /(?:^|\s)(?:MEMBER\s+)?(\d+)\s+(?:(?:TABLE\s+)?ST\s+)?([A-Z0-9X.×/\\-]+)\s+(PASS|FAIL)\s+(.+?)\s+([\d.]+)\s+(\d+)/i;
    // Forces can be on same line or next line
    const forcesOnSameLineRegex = /(?:^|\s)(?:MEMBER\s+)?(\d+)\s+(?:(?:TABLE\s+)?ST\s+)?([A-Z0-9X.×/\\-]+)\s+(PASS|FAIL)\s+(.+?)\s+([\d.]+)\s+(\d+)\s+([\d.-]+)\s+([TC])\s+([\d.-]+)\s+([\d.-]+)/i;
    const forceRegex = /(?:^|\s)([\d.-]+)\s+([TC])\s+([\d.-]+)\s+([\d.-]+)/i;

    // 3. Parse Steel Take-off
    const takeoff: { sec: string; len: number; wkN: number }[] = [];
    let inTakeoff = false;
    const takeoffRegex = /^\s*ST\s+([A-Z0-9X.×]+)\s+([\d.]+)\s+([\d.]+)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

    if (/MEMBER PROPERTY|MEMBER PROP/i.test(line)) inProps = true;
    if (inProps) {
      const m = line.match(propRegex);
      if (m) {
        const start = parseInt(m[1]);
        const end = parseInt(m[2]);
        const sec = m[3].toUpperCase().replace(/×/g, 'X').replace(/\s+/g, '');
        for (let id = start; id <= end; id++) memberProps[id] = sec;
      } else {
        const m2 = line.match(singlePropRegex);
        if (m2) {
           const id = parseInt(m2[1]);
           const sec = m2[2].toUpperCase().replace(/×/g, 'X').replace(/\s+/g, '');
           memberProps[id] = sec;
        }
      }
      if (/CONSTANTS|SUPPORTS|MEMBER SELECTION|STEEL DESIGN/i.test(line)) inProps = false;
    }

    if (/MEMBER SELECTION|STEEL DESIGN|SELECT MEMBER|CODE CHECK|CHECK RESULTS|DESIGN RESULTS|TRACK|MEMBER TABLE/i.test(line)) inSelect = true;
    
    // Fallback: if we see a line that looks exactly like a result, start parsing even without trigger
    if (!inSelect && (line.match(forcesOnSameLineRegex) || line.match(selectRegex))) {
      inSelect = true;
    }

    if (inSelect) {
      // Robust regex that handles optional "MEMBER" prefix and flexible spacing
      const mSame = line.match(forcesOnSameLineRegex);
      if (mSame) {
        const mid = parseInt(mSame[1]);
        const sec = mSame[2].toUpperCase().replace(/×/g, 'X').replace(/\s+/g, '');
        results[mid] = { 
          sec, result: mSame[3], cond: mSame[4].trim(), uc: parseFloat(mSame[5]), lc: parseInt(mSame[6]),
          FX: parseFloat(mSame[7]), MZ: parseFloat(mSame[10])
        };
      } else {
        const m = line.match(selectRegex);
        if (m) {
          const mid = parseInt(m[1]);
          const sec = m[2].toUpperCase().replace(/×/g, 'X').replace(/\s+/g, '');
          const result = m[3];
          const cond = m[4].trim();
          const uc = parseFloat(m[5]);
          const lc = parseInt(m[6]);
          
          let FX = 0, MZ = 0;
          if (i + 1 < lines.length) {
            const fm = lines[i+1].match(forceRegex);
            if (fm) {
              FX = parseFloat(fm[1]);
              MZ = parseFloat(fm[4]);
            }
          }
          results[mid] = { sec, result, uc, lc, cond, FX, MZ };
        }
      }
      // Stop if we hit a new major section
      if (/END OF TABULATED|STEEL TAKE-OFF|MEMBER PROPERTY|FINISH/i.test(line)) {
        if (Object.keys(results).length > 0) inSelect = false;
      }
      // Or a long line of dashes
      if (/^\s*[-=]{30,}/.test(line)) {
        if (Object.keys(results).length > 0) inSelect = false;
      }
    }

      if (/STEEL TAKE-OFF/i.test(line)) inTakeoff = true;
      if (inTakeoff) {
        const m = line.match(takeoffRegex);
        if (m) {
          takeoff.push({
            sec: m[1].toUpperCase().replace(/×/g, 'X').replace(/\s+/g, ''),
            len: parseFloat(m[2]),
            wkN: parseFloat(m[3])
          });
        }
        if (/TOTAL\s*=/i.test(line)) inTakeoff = false;
      }
    }

    if (Object.keys(results).length > 0) {
      // Estimate lengths
      const newLengths: Record<number, number> = {};
      takeoff.forEach(t => {
        const membersWithSec = Object.values(results).filter(r => r.sec === t.sec).length;
        if (membersWithSec > 0) {
          const avgLen = t.len / membersWithSec;
          Object.keys(results).forEach(idStr => {
            const id = parseInt(idStr);
            if (results[id].sec === t.sec) newLengths[id] = avgLen;
          });
        }
      });
      setMemberLengths(newLengths);

      const newMembers = Object.keys(results).map(idStr => {
        const id = parseInt(idStr);
        const r = results[id];
        const origSec = memberProps[id] || r.sec;
        const type = detectType(origSec);
        
        const series = getSeriesForSec(r.sec);
        const options = series.map(sec => {
          const uc = scaleUC(r.sec, r.uc, sec, type);
          const d = DB[sec];
          return {
            sec,
            uc,
            m: d ? d.m : 0,
            inBand: uc !== null && uc >= LO && uc <= HI,
            passes: uc !== null && uc <= 1.0,
            isStaad: sec === r.sec
          };
        }).filter(o => o.uc !== null && o.m !== null).sort((a, b) => a.m - b.m);

        const inBand = options.filter(o => o.inBand);
        const maxUCSection = options.find(o => o.passes)?.sec || r.sec;
        const recommended = inBand.length > 0 ? inBand[0].sec
          : (options.find(o => o.passes)?.sec || r.sec);

        return {
          id, origSec, origUC: r.uc, origPass: r.result === 'PASS',
          staadSec: r.sec, staadUC: r.uc, FX: r.FX, MZ: r.MZ, cond: r.cond, lc: r.lc,
          type, options, recommended, maxUCSection, chosen: recommended
        };
      });

      setMembers(newMembers);
      if (takeoff.length > 0) setOrigTakeoff(takeoff);
      showToast(`✓ Project updated with ${newMembers.length} members`);
    } else {
      if (takeoff.length > 0) {
        setOrigTakeoff(takeoff);
        setUploadStatus({ msg: '✓ Take-off found, but no Selection results. Check PDF format.', cls: 'amb' });
        setMembers([]);
      } else {
        setUploadStatus({ msg: 'No STAAD results found. Check PDF format (must contain MEMBER SELECTION or CODE CHECK table).', cls: 'red' });
        setMembers([]);
      }
    }
  };

  const pick = (id: number, sec: string) => {
    const m = members.find(x => x.id === id);
    if (m) {
      const chosenUC = m.options.find(o => o.sec === sec)?.uc || 0;
      showToast(`M${id} → ${sec} · UC ${(chosenUC * 100).toFixed(1)}%`);
    }
    setMembers(prev => prev.map(m => m.id === id ? { ...m, chosen: sec } : m));
  };

  const applyAll = () => {
    setMembers(prev => prev.map(m => ({ ...m, chosen: m.recommended })));
    showToast(`✓ All set to recommended (lightest optimized sections)`);
  };

  const applyMaxUC = () => {
    setMembers(prev => prev.map(m => ({ ...m, chosen: m.maxUCSection })));
    showToast('✓ All set to Max Utilization (lightest passing section)');
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    const ids = filteredMembers.map(m => m.id);
    setSelectedIds(new Set(ids));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const applyToSelected = (sec: string) => {
    setMembers(prev => prev.map(m => selectedIds.has(m.id) ? { ...m, chosen: sec } : m));
    showToast(`✓ Applied ${sec} to ${selectedIds.size} members`);
    setSelectedIds(new Set());
  };

  const exportCSV = () => {
    const h = 'MemberID,Type,OrigSection,OrigUC,OrigResult,STAADSection,STAADUC,ChosenSection,ChosenUC,FX_kN,MZ_kNm,Length_m,ChosenMass_kg_m,ChosenTonnes,GovCond,LC\n';
    const rows = members.map(m => {
      const co = m.options.find(o => o.sec === m.chosen);
      const t = memberTonnes(m.chosen, m.id, memberLengths);
      return `${m.id},${m.type},${m.origSec},${m.origUC},${m.origPass ? 'PASS' : 'FAIL'},${m.staadSec},${m.staadUC},${m.chosen},${co?.uc?.toFixed(3) || ''},${m.FX},${m.MZ},${getLen(m.id, m.chosen, memberLengths)},${DB[m.chosen]?.m || ''},${t.toFixed(4)},${m.cond},${m.lc}`;
    }).join('\n');
    const blob = new Blob([h + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SteelOpt_IndStructure.csv';
    a.click();
    showToast('✓ CSV exported');
  };

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      if (fType !== 'all' && m.type !== fType) return false;
      if (fUC !== 'all') {
        if (fUC === 'ok' && !(m.staadUC >= LO && m.staadUC <= HI)) return false;
        if (fUC === 'warn' && m.staadUC >= LO) return false;
        if (fUC === 'fail' && m.staadUC < 1.0) return false;
      }
      if (fSec !== 'all' && m.origSec !== fSec) return false;
      return true;
    });
  }, [members, fType, fUC, fSec]);

  const staadTonnage = useMemo(() => members.reduce((s, m) => s + memberTonnes(m.staadSec, m.id, memberLengths), 0), [members, memberLengths]);
  const chosenTonnage = useMemo(() => members.reduce((s, m) => s + memberTonnes(m.chosen, m.id, memberLengths), 0), [members, memberLengths]);
  const parsedOrigTonnage = useMemo(() => members.reduce((s, m) => s + memberTonnes(m.origSec, m.id, memberLengths), 0), [members, memberLengths]);
  
  // Use parsedOrigTonnage for savings calculation if it's more representative than the takeoff table
  const baseTon = parsedOrigTonnage > 0 ? parsedOrigTonnage : origTotalTon;
  const saveVsOrig = baseTon - chosenTonnage;
  const savePct = baseTon > 0 ? (saveVsOrig / baseTon * 100) : 0;

  return (
    <div className="flex flex-col h-screen bg-bg text-t1 font-sans">
      {/* HEADER */}
<header className="min-h-[52px] h-auto bg-s1 border-b border-white/10 flex flex-col md:flex-row items-center px-5 py-3 md:py-0 gap-3.5 shrink-0">
  <div className="flex items-center justify-between w-full md:w-auto">
    <div className="font-head text-[22px] font-extrabold tracking-[0.5px]">
      Steel<span className="text-gold">Opt</span>
    </div>
    {/* Show a condensed version of the code on mobile */}
    <div className="md:hidden font-mono text-[10px] px-2 py-0.5 rounded bg-gold/10 border border-gold/25 text-gold">
      BS5950
    </div>
  </div>

  <div className="flex flex-wrap gap-2 items-center w-full md:w-auto md:ml-auto justify-center md:justify-end">
    {selectedIds.size > 0 && (
      <div className="flex items-center gap-2 mr-2 pr-2 border-r border-white/10">
        <span className="font-mono text-[11px] text-gold font-bold">{selectedIds.size}</span>
        <button className="btn btn-ghost btn-sm text-[10px]" onClick={clearSelection}>Clear</button>
      </div>
    )}
    
    <button className="btn btn-ghost btn-sm flex items-center gap-2 border border-white/10" onClick={exportCSV}>
      <Download className="w-3 h-3" /> <span className="hidden sm:inline">Export CSV</span>
    </button>
    
    <button className="btn btn-gold btn-sm flex items-center gap-2" onClick={applyAll}>
      <Check className="w-3 h-3" /> <span className="hidden sm:inline">Apply Best Sections</span>
    </button>
  </div>
</header>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL */}
        <aside className="w-[310px] shrink-0 bg-s1 border-r border-white/5 flex flex-col overflow-hidden">
          <div className="px-3.5 py-2 border-b border-white/5 font-head text-[10px] font-bold tracking-[1.8px] uppercase text-t3 flex items-center justify-between">
            STAAD Output PDF
          </div>

          {/* UPLOAD ZONE */}
          <div 
            className={`m-3 border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-200 bg-s2 shrink-0 relative
              ${uploadStatus?.cls === 'grn' ? 'border-grn bg-grn/10' : 'border-white/10 hover:border-gold hover:bg-gold/5'}`}
            onClick={() => document.getElementById('pdfInput')?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) processFile(f);
            }}
          >
            <input 
              type="file" 
              id="pdfInput" 
              className="hidden" 
              accept=".pdf,.anl,.out,.txt" 
              onChange={(e) => { handleFile(e); e.target.value = ''; }} 
            />
            <Upload className={`w-8 h-8 mx-auto mb-2 ${uploadStatus?.cls === 'grn' ? 'text-grn' : 'text-t2'}`} />
            <div className="font-semibold text-sm text-t1 mb-1">Upload STAAD Output</div>
            <div className="text-[11px] text-t2 leading-relaxed">Drop your .pdf file here<br />or click to browse</div>
            {uploadStatus && (
              <div className={`mt-2 font-mono text-[10px] px-2.5 py-0.5 rounded inline-block
                ${uploadStatus.cls === 'grn' ? 'bg-grn/10 text-grn' : uploadStatus.cls === 'amb' ? 'bg-amb/10 text-amb' : 'bg-red/10 text-red'}`}>
                {uploadStatus.msg}
              </div>
            )}
          </div>

          <div className="px-3 pb-1.5 font-mono text-[10px] text-t3 text-center">
            — or using loaded data —
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <FilterSection 
              title="Member Type" 
              action={<button className="text-[9px] text-gold hover:underline font-mono uppercase tracking-wider" onClick={selectAllFiltered}>Select All</button>}
            >
              <div className="flex flex-wrap gap-1.5">
                <FilterPill label="All" active={fType === 'all'} onClick={() => setFType('all')} count={members.length} />
                {Object.entries(TYPE_META).map(([key, meta]) => (
                  <FilterPill 
                    key={key} 
                    label={meta.label} 
                    active={fType === key} 
                    onClick={() => setFType(key)} 
                    count={members.filter(m => m.type === key).length}
                    dotColor={meta.color}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection title="UC Status">
              <div className="flex flex-wrap gap-1.5">
                <FilterPill label="All" active={fUC === 'all'} onClick={() => setFUC('all')} />
                <FilterPill label="Optimized" active={fUC === 'ok'} onClick={() => setFUC('ok')} />
                <FilterPill label="< 80% UC" active={fUC === 'warn'} onClick={() => setFUC('warn')} />
                <FilterPill label="Over" active={fUC === 'fail'} onClick={() => setFUC('fail')} />
              </div>
            </FilterSection>

            <FilterSection title="Original Section">
              <div className="flex flex-wrap gap-1.5">
                <FilterPill label="All" active={fSec === 'all'} onClick={() => setFSec('all')} />
                {Array.from(new Set(members.map(m => m.origSec))).map((sec) => (
                  <FilterPill key={sec as string} label={sec as string} active={fSec === sec} onClick={() => setFSec(sec as string)} className="text-[9px]" />
                ))}
              </div>
            </FilterSection>

            <FilterSection title="Original Takeoff (from PDF)">
              <div className="bg-s2 border border-white/5 rounded-lg p-3">
                <div className="font-mono text-[10px] leading-[2.1] text-t2">
                  {origTakeoff.map((r, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{r.sec}</span>
                      <span className="text-t3">{r.len.toFixed(2)} m · {r.wkN.toFixed(2)} kN</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-white/5 mt-2 pt-2 font-head text-base font-extrabold text-t1">
                  Total: <span className="text-gold">{origTotalKN.toFixed(2)} kN</span>
                  <span className="text-[12px] text-t3 ml-2">(≈ {origTotalTon.toFixed(2)} tonnes)</span>
                </div>
              </div>
            </FilterSection>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* TONNAGE BANNER */}
          <div className="bg-s1 border-b border-white/10 flex items-stretch shrink-0">
            <BannerCol 
              label="Before (Original)" 
              val={`${parsedOrigTonnage.toFixed(2)} t`} 
              sub={`Parsed members only (Total PDF: ${origTotalTon.toFixed(2)}t)`} 
              valCls="text-t2" 
            />
            <div className="flex items-center px-2 text-t3 text-xl">→</div>
            <BannerCol label="After (STAAD Select)" val={`${staadTonnage.toFixed(2)} t`} sub="STAAD SELECT ALL result" valCls="text-blu" />
            <div className="flex items-center px-2 text-t3 text-xl">→</div>
            <BannerCol label="After (Your Selection)" val={`${chosenTonnage.toFixed(2)} t`} sub="Based on your section choices" valCls="text-gold" />
            <BannerCol 
              label="Saving vs Original" 
              val={`${saveVsOrig >= 0 ? '-' : '+'}${Math.abs(saveVsOrig).toFixed(2)} t`} 
              sub={`${Math.abs(savePct).toFixed(1)}% ${saveVsOrig >= 0 ? 'reduction' : 'increase'}`}
              valCls={saveVsOrig >= 0 ? 'text-grn' : 'text-red'}
              minWidth="140px"
            />
          </div>

          <div className="px-5 pb-3.5 bg-s1 border-b border-white/10 shrink-0">
            <div className="h-1.5 bg-s3 rounded-full overflow-hidden mb-1">
              <motion.div 
                className={`h-full rounded-full ${saveVsOrig >= 0 ? 'bg-grn' : 'bg-red'}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, Math.max(0, savePct))}%` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[9px] text-t3">
              <span>{Math.abs(savePct).toFixed(1)}%</span>
              <span>Weight saved</span>
              <span>{Math.abs(saveVsOrig).toFixed(2)} t</span>
            </div>
          </div>

          {/* LEGEND */}
          <div className="flex gap-3 px-4 py-1.5 bg-s1 border-b border-white/5 shrink-0 flex-wrap">
            <LegendItem color="var(--color-grn)" label="Optimized" />
            <LegendItem color="var(--color-amb)" label="Under-utilised" />
            <LegendItem color="var(--color-red)" label="Over-stressed >1.00" />
            <LegendItem color="var(--color-blu)" label="STAAD Selected" />
            <div className="font-mono text-[10px] text-t2 ml-auto">✅ Recommended | 🟡 Your choice</div>
          </div>

          {/* TABS */}
          <div className="flex bg-s1 border-b border-white/5 shrink-0">
            <Tab label="Section Suggestions" active={activeTab === 'suggestions'} onClick={() => setActiveTab('suggestions')} />
            <Tab label="Comparison" active={activeTab === 'comparison'} onClick={() => setActiveTab('comparison')} />
            <Tab label="Before / After Tonnage" active={activeTab === 'tonnage'} onClick={() => setActiveTab('tonnage')} />
            <Tab label="BOQ Schedule" active={activeTab === 'boq'} onClick={() => setActiveTab('boq')} />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <AnimatePresence mode="wait">
              {activeTab === 'suggestions' && (
                <motion.div 
                  key="suggestions"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {filteredMembers.length === 0 ? (
                    <div className="text-center py-16 text-t3 font-mono">No members match filters</div>
                  ) : (
                    <div className="space-y-6">
                      {Object.entries(groupByType(filteredMembers)).map(([type, mems]) => (
                        <div key={type}>
                          <div className="flex items-center gap-2.5 mb-2 pb-2 border-b border-white/5">
                            <div className="w-1 h-5 rounded" style={{ backgroundColor: TYPE_META[type].color }}></div>
                            <div className="font-head text-[15px] font-extrabold" style={{ color: TYPE_META[type].color }}>
                              {TYPE_META[type].label}s
                            </div>
                            <div className="font-mono text-[10px] text-t3">{mems.length} members</div>
                            <button 
                              className="ml-auto font-mono text-[9px] text-gold hover:underline"
                              onClick={() => {
                                const ids = mems.map(m => m.id);
                                setSelectedIds(prev => {
                                  const next = new Set(prev);
                                  ids.forEach(id => next.add(id));
                                  return next;
                                });
                              }}
                            >
                              Select All {TYPE_META[type].label}s
                            </button>
                          </div>
                          <div className="space-y-1.5">
                            {mems.map(m => (
                              <MemberCard 
                                key={m.id} 
                                member={m} 
                                selected={selectedIds.has(m.id)}
                                onSelect={() => toggleSelect(m.id)}
                                expanded={expandedMember === m.id}
                                onToggle={() => setExpandedMember(expandedMember === m.id ? null : m.id)}
                                onPick={pick}
                                onApplyToSelected={applyToSelected}
                                hasSelection={selectedIds.size > 0}
                                selectionCount={selectedIds.size}
                                showOriginal={showOriginal}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'comparison' && (
                <motion.div 
                  key="comparison"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <ComparisonPanel members={members} memberLengths={memberLengths} />
                </motion.div>
              )}

              {activeTab === 'tonnage' && (
                <motion.div 
                  key="tonnage"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="max-w-[900px]"
                >
                  <TonnagePanel 
                    members={members} 
                    staadTonnage={staadTonnage} 
                    chosenTonnage={chosenTonnage} 
                    origTotalTon={origTotalTon}
                    parsedOrigTonnage={parsedOrigTonnage}
                    origTakeoff={origTakeoff}
                    memberLengths={memberLengths}
                  />
                </motion.div>
              )}

              {activeTab === 'boq' && (
                <motion.div 
                  key="boq"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <BOQPanel members={members} memberLengths={memberLengths} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* TOAST */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed bottom-5 left-1/2 bg-s3 border border-white/15 text-t1 text-xs px-5 py-2.5 rounded-lg z-[999] font-mono shadow-2xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── COMPONENTS ────────────────────────────────────────────────

function FilterSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <div className="font-mono text-[9px] text-t3 tracking-[1.2px] uppercase">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

interface FilterPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
  dotColor?: string;
  className?: string;
}

const FilterPill: React.FC<FilterPillProps> = ({ label, active, onClick, count, dotColor, className = "" }) => {
  return (
    <button 
      onClick={onClick}
      className={`font-mono text-[10px] px-2.5 py-1 rounded-full border transition-all duration-150 flex items-center gap-1
        ${active ? 'border-gold text-gold bg-gold/10' : 'border-white/10 text-t2 hover:border-white/20 hover:text-t1'} ${className}`}
    >
      {dotColor && <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }}></div>}
      {label}
      {count !== undefined && <span className="text-t3 text-[9px] ml-0.5">{count}</span>}
    </button>
  );
}

function BannerCol({ label, val, sub, valCls, minWidth }: { label: string; val: string; sub: string; valCls?: string; minWidth?: string }) {
  return (
    <div className="flex-1 p-3.5 flex flex-col justify-center border-r border-white/5 last:border-none" style={{ minWidth }}>
      <div className="font-mono text-[9px] tracking-[1.5px] uppercase text-t3 mb-1">{label}</div>
      <div className={`font-head text-[30px] font-extrabold leading-none mb-1 ${valCls}`}>{val}</div>
      <div className="text-[11px] text-t2 truncate">{sub}</div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] text-t2">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }}></div>
      {label}
    </div>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`px-4.5 py-2.5 font-head text-[11px] font-bold tracking-[1px] uppercase transition-all duration-150 border-b-2
        ${active ? 'text-gold border-gold' : 'text-t3 border-transparent hover:text-t2'}`}
    >
      {label}
    </button>
  );
}

interface MemberCardProps {
  member: Member;
  selected: boolean;
  onSelect: () => void;
  expanded: boolean;
  onToggle: () => void;
  onPick: (id: number, sec: string) => void;
  onApplyToSelected: (sec: string) => void;
  hasSelection: boolean;
  selectionCount: number;
  showOriginal?: boolean;
}

const MemberCard: React.FC<MemberCardProps> = ({ member, selected, onSelect, expanded, onToggle, onPick, onApplyToSelected, hasSelection, selectionCount, showOriginal }) => {
  const chosenUC = showOriginal ? member.origUC : (member.options.find(o => o.sec === member.chosen)?.uc || member.staadUC);
  const meta = TYPE_META[member.type];
  const changed = member.origSec !== member.staadSec;
  const displaySec = showOriginal ? member.origSec : member.chosen;

  return (
    <div className={`bg-s2 border rounded-lg overflow-hidden transition-all duration-150 relative
      ${expanded ? 'border-white/15' : 'border-white/5 hover:border-white/10'}
      ${selected ? 'ring-1 ring-gold border-gold/50 bg-gold/5' : ''}`}>
      
      <div className="flex items-center p-2.5 gap-2.5">
        <div 
          className={`w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors
            ${selected ? 'bg-gold border-gold' : 'border-white/20 hover:border-white/40'}`}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
          {selected && <Check className="w-3 h-3 text-s1 stroke-[4px]" />}
        </div>

        <div className="flex items-center gap-2.5 flex-1 cursor-pointer" onClick={onToggle}>
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ucColor(member.staadUC) }}></div>
          <div className="font-mono text-[10px] bg-s4 rounded px-1.5 py-0.5 text-blu min-w-[30px] text-center shrink-0">M{member.id}</div>
          <div className="text-t2 shrink-0">{meta.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {changed && !showOriginal && <span className="font-mono text-[10px] text-t3 line-through">{member.origSec}</span>}
              {changed && !showOriginal && <span className="text-gold text-[10px]">→</span>}
              <span className={`font-mono text-[12px] font-bold ${showOriginal ? 'text-t2' : 'text-t1'}`}>{displaySec}</span>
              {!showOriginal && (member.recommended !== member.staadSec ? (
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-grn/30 bg-grn/10 text-grn">✅ Better option</span>
              ) : (
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-blu/30 bg-blu/10 text-blu">STAAD</span>
              ))}
              {showOriginal && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-white/20 bg-white/5 text-t3">Original</span>}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-t3">
              LC{member.lc} · {member.cond} · Fx={member.FX.toFixed(0)}kN · Mz={member.MZ.toFixed(1)}kN·m
            </div>
          </div>
          <div className="w-[72px] shrink-0">
            <div className="h-1 bg-s4 rounded-full overflow-hidden mb-0.5">
              <div 
                className={`h-full rounded-full ${ucBarCls(chosenUC)}`} 
                style={{ width: `${Math.min(100, Math.round(chosenUC * 100))}%` }}
              ></div>
            </div>
            <div className={`font-mono text-[10px] text-right ${ucTextCls(chosenUC)}`}>
              {(chosenUC * 100).toFixed(1)}% UC
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div 
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 pt-0 border-t border-white/5">
                <div className="grid grid-cols-5 gap-1.5 mt-2">
                  <DetailGrid label="Original" val={member.origSec} valSize="10px" />
                  <DetailGrid label="Orig UC" val={`${(member.origUC * 100).toFixed(1)}% ${member.origPass ? '✓' : '✗'}`} valColor={member.origPass ? 'var(--color-amb)' : 'var(--color-red)'} />
                  <DetailGrid label="STAAD Select" val={member.staadSec} valSize="10px" valColor="var(--color-blu)" />
                  <DetailGrid label="STAAD UC" val={`${(member.staadUC * 100).toFixed(1)}%`} valColor={ucColor(member.staadUC)} />
                  <DetailGrid label="Max UC Option" val={member.maxUCSection} valSize="10px" valColor="var(--color-gold)" />
                </div>

              <div className="mt-2.5 bg-s3 rounded-md p-2.5 border border-white/10">
                <div className="font-head text-[11px] font-bold tracking-[1px] uppercase text-t2 mb-2 flex items-center justify-between">
                  {hasSelection ? `Apply to ${selectionCount} selected members` : `Choose Section for M${member.id}`}
                </div>
                <div className="flex flex-col gap-1">
                  {member.options.map(o => (
                    <SectionOption 
                      key={o.sec} 
                      option={o} 
                      chosen={member.chosen === o.sec} 
                      recommended={member.recommended === o.sec}
                      isMaxUC={member.maxUCSection === o.sec}
                      onClick={() => {
                        if (!o.passes) return;
                        if (hasSelection) onApplyToSelected(o.sec);
                        else onPick(member.id, o.sec);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailGrid({ label, val, valSize, valColor }: { label: string; val: string; valSize?: string; valColor?: string }) {
  return (
    <div className="bg-s3 rounded p-2 border border-white/5">
      <div className="text-[9px] text-t3 font-mono uppercase tracking-wider mb-0.5">{label}</div>
      <div className="font-mono text-[11px] font-medium" style={{ fontSize: valSize, color: valColor }}>{val}</div>
    </div>
  );
}

interface SectionOptionProps {
  option: MemberOption;
  chosen: boolean;
  recommended: boolean;
  isMaxUC?: boolean;
  onClick: () => void;
}

const SectionOption: React.FC<SectionOptionProps> = ({ option, chosen, recommended, isMaxUC, onClick }) => {
  const isStaad = option.isStaad;
  const cls = chosen ? 'border-gold bg-gold/10' : recommended ? 'border-grn bg-grn/10' : isMaxUC ? 'border-gold/30 bg-gold/5' : option.passes ? 'border-white/10 bg-s4 hover:border-white/20' : 'border-red/20 opacity-50 cursor-not-allowed bg-s4';
  
  return (
    <div 
      className={`flex items-center p-2 rounded border cursor-pointer transition-all duration-150 gap-2.5 ${cls}`}
      onClick={onClick}
    >
      <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${chosen ? 'border-gold' : recommended ? 'border-grn' : isMaxUC ? 'border-gold/50' : 'border-white/20'}`}>
        {(chosen || recommended || isMaxUC) && <div className={`w-1.5 h-1.5 rounded-full ${chosen ? 'bg-gold' : recommended ? 'bg-grn' : 'bg-gold/50'}`}></div>}
      </div>
      <div className="font-mono text-[11px] font-bold flex-1 text-t1">
        {option.sec}
        {!DB[option.sec] && <span className="ml-2 text-[9px] text-red/60 font-normal italic">(Not in DB)</span>}
      </div>
      <div className="font-mono text-[10px] text-t2">{option.m} kg/m</div>
      <div className="font-mono text-[11px] font-bold px-2 py-0.5 rounded" style={{ color: ucColor(option.uc || 0), backgroundColor: `${ucColor(option.uc || 0)}18` }}>
        {((option.uc || 0) * 100).toFixed(1)}%
      </div>
      <div className="flex gap-1">
        {recommended && !chosen && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-grn/10 text-grn border border-grn/30">✅ Recommended</span>}
        {isMaxUC && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-gold/10 text-gold border border-gold/30">⚡ Max UC</span>}
        {isStaad && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-blu/10 text-blu border border-blu/30">STAAD</span>}
        {option.inBand && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-gold/10 text-gold border border-gold/30">Optimized</span>}
        {!option.passes && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-red/10 text-red border border-red/30">FAIL</span>}
      </div>
    </div>
  );
}

function ComparisonPanel({ members, memberLengths }: { members: Member[]; memberLengths: Record<number, number> }) {
  return (
    <div className="bg-s2 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="bg-s1 border-b border-white/10">
              <th className="text-left p-3 text-t3 font-normal uppercase tracking-wider">Member</th>
              <th className="text-left p-3 text-t3 font-normal uppercase tracking-wider">Type</th>
              <th className="text-left p-3 text-t3 font-normal uppercase tracking-wider">Before (Original)</th>
              <th className="text-left p-3 text-t3 font-normal uppercase tracking-wider">After (Optimized)</th>
              <th className="text-right p-3 text-t3 font-normal uppercase tracking-wider">Weight Change</th>
              <th className="text-right p-3 text-t3 font-normal uppercase tracking-wider">UC Change</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => {
              const origW = memberTonnes(m.origSec, m.id, memberLengths);
              const chosenW = memberTonnes(m.chosen, m.id, memberLengths);
              const diffW = chosenW - origW;
              const diffPct = origW > 0 ? (diffW / origW * 100) : 0;
              const chosenUC = m.options.find(o => o.sec === m.chosen)?.uc || m.staadUC;
              const diffUC = chosenUC - m.origUC;
              const meta = TYPE_META[m.type];

              return (
                <tr key={m.id} className="border-b border-white/5 hover:bg-s3/50 transition-colors">
                  <td className="p-3 text-t1 font-bold">M{m.id}</td>
                  <td className="p-3" style={{ color: meta.color }}>{meta.label}</td>
                  <td className="p-3 text-t2">{m.origSec} <span className="text-[9px] text-t3">({(m.origUC * 100).toFixed(1)}%)</span></td>
                  <td className="p-3 text-gold font-bold">{m.chosen} <span className="text-[9px] text-t3">({(chosenUC * 100).toFixed(1)}%)</span></td>
                  <td className={`p-3 text-right ${diffW < 0 ? 'text-grn' : diffW > 0 ? 'text-red' : 'text-t3'}`}>
                    {diffW !== 0 ? `${diffW > 0 ? '+' : ''}${(diffW * 1000).toFixed(1)} kg` : '—'}
                    {diffW !== 0 && <span className="text-[9px] ml-1 opacity-70">({diffPct.toFixed(1)}%)</span>}
                  </td>
                  <td className={`p-3 text-right ${diffUC < 0 ? 'text-grn' : diffUC > 0 ? 'text-red' : 'text-t3'}`}>
                    {diffUC !== 0 ? `${diffUC > 0 ? '+' : ''}${(diffUC * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TonnagePanel({ members, staadTonnage, chosenTonnage, origTotalTon, parsedOrigTonnage, origTakeoff, memberLengths }: { members: Member[]; staadTonnage: number; chosenTonnage: number; origTotalTon: number; parsedOrigTonnage: number; origTakeoff: { sec: string; len: number; wkN: number }[]; memberLengths: Record<number, number> }) {
  const baseTon = parsedOrigTonnage > 0 ? parsedOrigTonnage : origTotalTon;
  const saveVsOrig = baseTon - chosenTonnage;
  const saveVsStaad = staadTonnage - chosenTonnage;
  const posOrig = saveVsOrig >= 0;
  const posStaad = saveVsStaad >= 0;

  const chosenBySec: Record<string, number> = {};
  members.forEach(m => {
    if (!chosenBySec[m.chosen]) chosenBySec[m.chosen] = 0;
    chosenBySec[m.chosen] += memberTonnes(m.chosen, m.id, memberLengths);
  });

  const staadBySec: Record<string, number> = {};
  members.forEach(m => {
    if (!staadBySec[m.staadSec]) staadBySec[m.staadSec] = 0;
    staadBySec[m.staadSec] += memberTonnes(m.staadSec, m.id, memberLengths);
  });

  const origBySec: Record<string, number> = {};
  members.forEach(m => {
    if (!origBySec[m.origSec]) origBySec[m.origSec] = 0;
    origBySec[m.origSec] += memberTonnes(m.origSec, m.id, memberLengths);
  });

  return (
    <div className="space-y-6">
      {/* HERO CARD */}
      <div className={`rounded-xl p-5 flex items-center gap-5 border ${posOrig ? 'bg-grn/10 border-grn/30' : 'bg-red/10 border-red/30'}`}>
        <div className="text-4xl shrink-0">{posOrig ? '💚' : '⚠️'}</div>
        <div className="flex-1">
          <div className={`font-head text-[28px] font-extrabold leading-none mb-1 ${posOrig ? 'text-grn' : 'text-red'}`}>
            {posOrig ? '−' : '+'}{Math.abs(saveVsOrig).toFixed(2)} tonnes {posOrig ? 'saved' : 'added'}
          </div>
          <div className="text-xs text-t2">
            Your selection vs parsed original design · {baseTon > 0 ? (Math.abs(saveVsOrig) / baseTon * 100).toFixed(1) : 0}% weight {posOrig ? 'reduction' : 'increase'}
          </div>
          {posStaad && <div className="text-xs text-t2 mt-1">Also −{saveVsStaad.toFixed(2)} t vs STAAD SELECT</div>}
        </div>
        <div className="text-center">
          <div className="font-head text-[48px] font-extrabold text-gold leading-none">{baseTon > 0 ? (Math.abs(saveVsOrig) / baseTon * 100).toFixed(1) : 0}%</div>
          <div className="font-mono text-[10px] text-t3 tracking-wider uppercase">{posOrig ? 'Reduction' : 'Increase'}</div>
        </div>
      </div>

      {/* COMPARISON */}
      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <div className="font-head text-sm font-bold tracking-wider uppercase text-t2">Tonnage Comparison (Parsed Members)</div>
          <div className="flex-1 h-px bg-white/5"></div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] bg-s2 border border-white/10 rounded-xl overflow-hidden">
          <div className="p-6 border-r border-white/5">
            <div className="font-mono text-[10px] tracking-widest uppercase text-t3 mb-1">⬛ Before (Original Design)</div>
            <div className="font-head text-[42px] font-extrabold text-t2 leading-none">
              {baseTon.toFixed(2)}<span className="font-mono text-sm text-t3 ml-1">tonnes</span>
            </div>
            <div className="mt-4 space-y-1">
              {Object.entries(origBySec).sort((a, b) => b[1] - a[1]).map(([sec, t]) => (
                <div key={sec} className="flex justify-between text-[11px] border-b border-white/5 py-1">
                  <span className="font-mono text-t2">{sec}</span>
                  <span className="font-mono text-t1">{t.toFixed(3)} t</span>
                </div>
              ))}
              <div className="flex justify-between text-[11px] font-bold text-t1 border-t border-white/10 mt-1 pt-1">
                <span>TOTAL</span><span>{baseTon.toFixed(3)} t</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center px-5 text-3xl text-t3">→</div>

          <div className="p-6 border-l border-white/5">
            <div className="font-mono text-[10px] tracking-widest uppercase text-t3 mb-1">🟡 After (Your Selection)</div>
            <div className="font-head text-[42px] font-extrabold text-gold leading-none">
              {chosenTonnage.toFixed(2)}<span className="font-mono text-sm text-t3 ml-1">tonnes</span>
            </div>
            <div className="mt-4 space-y-1">
              {Object.entries(chosenBySec).sort((a, b) => b[1] - a[1]).map(([sec, t]) => {
                const reduced = t < (staadBySec[sec] || t + 0.01);
                return (
                  <div key={sec} className="flex justify-between text-[11px] border-b border-white/5 py-1">
                    <span className="font-mono text-t2">{sec}</span>
                    <span className={`font-mono ${reduced ? 'text-grn' : 'text-red'}`}>{t.toFixed(3)} t</span>
                  </div>
                );
              })}
              <div className="flex justify-between text-[11px] font-bold text-gold border-t border-white/10 mt-1 pt-1">
                <span>TOTAL</span><span>{chosenTonnage.toFixed(3)} t</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BOQPanel({ members, memberLengths }: { members: Member[]; memberLengths: Record<number, number> }) {
  const bySec: Record<string, { ids: number[]; totalKg: number; m: number; type: string }> = {};
  members.forEach(m => {
    if (!bySec[m.chosen]) bySec[m.chosen] = { ids: [], totalKg: 0, m: DB[m.chosen]?.m || 0, type: m.type };
    bySec[m.chosen].ids.push(m.id);
    bySec[m.chosen].totalKg += memberTonnes(m.chosen, m.id, memberLengths) * 1000;
  });

  const rows = Object.entries(bySec).sort((a, b) => b[1].totalKg - a[1].totalKg);
  const grandKg = rows.reduce((s, [, d]) => s + d.totalKg, 0);

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <div className="font-head text-sm font-bold tracking-wider uppercase text-t2">Bill of Quantities — Your Selection</div>
        <div className="flex-1 h-px bg-white/5"></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left p-2 text-t3 font-normal uppercase tracking-wider">Section</th>
              <th className="text-left p-2 text-t3 font-normal uppercase tracking-wider">Type</th>
              <th className="text-right p-2 text-t3 font-normal uppercase tracking-wider">kg/m</th>
              <th className="text-left p-2 text-t3 font-normal uppercase tracking-wider">Members</th>
              <th className="text-right p-2 text-t3 font-normal uppercase tracking-wider">Count</th>
              <th className="text-right p-2 text-t3 font-normal uppercase tracking-wider">Total (kg)</th>
              <th className="text-right p-2 text-t3 font-normal uppercase tracking-wider">Total (t)</th>
              <th className="text-right p-2 text-t3 font-normal uppercase tracking-wider w-32">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([sec, d]) => {
              const meta = TYPE_META[d.type] || { icon: '●', color: 'var(--color-t2)', label: d.type };
              const pct = grandKg > 0 ? (d.totalKg / grandKg * 100) : 0;
              return (
                <tr key={sec} className="border-b border-white/5 hover:bg-s2">
                  <td className="p-2 font-bold text-t1">{sec}</td>
                  <td className="p-2" style={{ color: meta.color }}>{meta.label}</td>
                  <td className="p-2 text-right">{d.m}</td>
                  <td className="p-2 text-[10px] text-t3 max-w-[200px] truncate">{d.ids.join(', ')}</td>
                  <td className="p-2 text-right text-gold">{d.ids.length}</td>
                  <td className="p-2 text-right">{d.totalKg.toFixed(0)}</td>
                  <td className="p-2 text-right text-gold">{(d.totalKg / 1000).toFixed(3)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-s4 rounded-full overflow-hidden">
                        <div className="h-full bg-gold rounded-full" style={{ width: `${pct}%` }}></div>
                      </div>
                      <span className="text-t2 text-[10px] min-w-[32px]">{pct.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 font-bold text-t1">
              <td colSpan={5} className="p-2">GRAND TOTAL</td>
              <td className="p-2 text-right">{grandKg.toFixed(0)} kg</td>
              <td className="p-2 text-right text-gold">{(grandKg / 1000).toFixed(3)} t</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
// ── UTILS ─────────────────────────────────────────────────────

function groupByType(mems: Member[]) {
  const grouped: Record<string, Member[]> = {};
  mems.forEach(m => {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(m);
  });
  return grouped;
}
