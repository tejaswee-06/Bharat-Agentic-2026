import React, { createContext, useContext, useState, useRef, useEffect, useMemo } from "react";
import {
  LayoutGrid, Camera, ShieldAlert, Map as MapIcon, Bell, GitBranch, Search, X, Play,
  Upload, CheckCircle2, AlertTriangle, MapPin, ZoomIn, ZoomOut, Layers, ArrowRight,
  Clock, Radio, Target, ChevronRight, Menu, TreePine, Activity, Crosshair, RefreshCw,
  Check, ChevronDown, ScanLine, Waves, Compass, BellRing, ExternalLink, Mic, MicOff,
  Volume2, VolumeX, Sun, Moon, Accessibility, Pause
} from "lucide-react";

import RealGISMap from "./gis/RealGISMap.jsx";

/* ============================== BACKEND CONFIG ============================== */

// FastAPI (Ultralytics YOLO) backend — see backend/predict.py
export const API_BASE_URL = "http://localhost:8000";

/* ============================== DEMO DATA ============================== */

export const SPECIES_LIST = ["Asian Elephant", "Leopard", "Wild Boar", "Spotted Deer", "Tiger"];

export const ZONES = [
  {
    id: "Z-01", name: "Northern Ridge", x: 20, y: 14, riskLevel: "LOW", risk: 18,
    species: "Spotted Deer", recentDetections: 5, historicalConflicts: 0,
    settlementProximity: "LOW",
    environmentalContext: "Open grassland ridge, well outside cultivated land. Sparse human footfall.",
    recommended: "ROUTINE MONITORING",
    factors: { wildlifeActivity: "LOW", historicalConflict: "LOW", settlementProximity: "LOW", temporalPattern: "LOW", environmentalContext: "LOW", spatialRelationship: "LOW" },
    topFactors: ["Low historical conflict", "Minimal settlement proximity", "Stable seasonal pattern"],
  },
  {
    id: "Z-02", name: "River Bend", x: 66, y: 24, riskLevel: "MEDIUM", risk: 52,
    species: "Wild Boar", recentDetections: 8, historicalConflicts: 2,
    settlementProximity: "MEDIUM",
    environmentalContext: "Riverine cropland adjacent to seasonal water source, drawing boar during dry months.",
    recommended: "INCREASE PATROL FREQUENCY",
    factors: { wildlifeActivity: "MEDIUM", historicalConflict: "MEDIUM", settlementProximity: "MEDIUM", temporalPattern: "MEDIUM", environmentalContext: "MEDIUM", spatialRelationship: "LOW" },
    topFactors: ["Crop-raiding pattern near fields", "Seasonal water dependency", "Moderate settlement proximity"],
  },
  {
    id: "Z-03", name: "Forest Edge", x: 30, y: 44, riskLevel: "MEDIUM", risk: 61,
    species: "Leopard", recentDetections: 7, historicalConflicts: 3,
    settlementProximity: "MEDIUM",
    environmentalContext: "Dense canopy edge bordering a livestock grazing belt; frequent dusk sightings.",
    recommended: "DEPLOY ADDITIONAL CAMERA TRAPS",
    factors: { wildlifeActivity: "MEDIUM", historicalConflict: "HIGH", settlementProximity: "MEDIUM", temporalPattern: "HIGH", environmentalContext: "MEDIUM", spatialRelationship: "MEDIUM" },
    topFactors: ["Historical conflict pattern", "Dusk/nocturnal activity spike", "Livestock grazing overlap"],
  },
  {
    id: "Z-04", name: "Settlement Corridor", x: 50, y: 60, riskLevel: "HIGH", risk: 89,
    species: "Asian Elephant", recentDetections: 12, historicalConflicts: 4,
    settlementProximity: "HIGH",
    environmentalContext: "Dense forest adjoining agricultural fields; monsoon vegetation growth increasing corridor overlap with settlement.",
    recommended: "PRIORITIZE MONITORING",
    factors: { wildlifeActivity: "HIGH", historicalConflict: "HIGH", settlementProximity: "HIGH", temporalPattern: "MEDIUM", environmentalContext: "MEDIUM", spatialRelationship: "HIGH" },
    topFactors: ["Recent wildlife activity", "Settlement proximity", "Historical conflict pattern"],
  },
  {
    id: "Z-05", name: "Hillside Trail", x: 76, y: 52, riskLevel: "LOW", risk: 24,
    species: "Spotted Deer", recentDetections: 4, historicalConflicts: 0,
    settlementProximity: "LOW",
    environmentalContext: "Elevated trail with light foliage; herds pass through en route to grazing meadow.",
    recommended: "ROUTINE MONITORING",
    factors: { wildlifeActivity: "LOW", historicalConflict: "LOW", settlementProximity: "LOW", temporalPattern: "LOW", environmentalContext: "MEDIUM", spatialRelationship: "LOW" },
    topFactors: ["Predictable migratory pattern", "Low settlement overlap", "No recorded conflict"],
  },
  {
    id: "Z-06", name: "Buffer Zone South", x: 40, y: 80, riskLevel: "HIGH", risk: 82,
    species: "Tiger", recentDetections: 6, historicalConflicts: 3,
    settlementProximity: "MEDIUM",
    environmentalContext: "Core-buffer boundary with rising nocturnal movement toward the reserve's southern edge.",
    recommended: "PRIORITIZE MONITORING",
    factors: { wildlifeActivity: "HIGH", historicalConflict: "HIGH", settlementProximity: "MEDIUM", temporalPattern: "HIGH", environmentalContext: "MEDIUM", spatialRelationship: "HIGH" },
    topFactors: ["Nocturnal movement near boundary", "Historical conflict pattern", "Core-buffer overlap"],
  },
  {
    id: "Z-07", name: "Valley Watch", x: 20, y: 76, riskLevel: "MEDIUM", risk: 58,
    species: "Leopard", recentDetections: 6, historicalConflicts: 2,
    settlementProximity: "MEDIUM",
    environmentalContext: "Narrow valley corridor linking two forest blocks, crossed by a footpath used at dawn.",
    recommended: "INCREASE PATROL FREQUENCY",
    factors: { wildlifeActivity: "MEDIUM", historicalConflict: "MEDIUM", settlementProximity: "MEDIUM", temporalPattern: "MEDIUM", environmentalContext: "LOW", spatialRelationship: "MEDIUM" },
    topFactors: ["Dawn footpath overlap", "Corridor connectivity", "Moderate conflict history"],
  },
];

export const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.id, z]));

const DEMO_IMAGES = [
  { id: "img-1", label: "CT-104.JPG", desc: "Trail Cam · Zone Z-04 · 06:42", species: "Asian Elephant", confidence: 94, zone: "Z-04" },
  { id: "img-2", label: "CT-087.JPG", desc: "Trail Cam · Zone Z-06 · 21:15", species: "Tiger", confidence: 88, zone: "Z-06" },
  { id: "img-3", label: "CT-052.JPG", desc: "Trail Cam · Zone Z-03 · 19:03", species: "Leopard", confidence: 91, zone: "Z-03" },
];

let idCounter = 200;
const nextId = (prefix) => `${prefix}-${idCounter++}`;

const INITIAL_DETECTIONS = [
  { id: "D-104", species: "Asian Elephant", confidence: 94, zone: "Z-04", timestamp: "Today, 06:42" },
  { id: "D-099", species: "Wild Boar", confidence: 81, zone: "Z-02", timestamp: "Today, 05:10" },
  { id: "D-095", species: "Leopard", confidence: 91, zone: "Z-03", timestamp: "Yesterday, 19:03" },
  { id: "D-091", species: "Tiger", confidence: 88, zone: "Z-06", timestamp: "Yesterday, 21:15" },
  { id: "D-086", species: "Spotted Deer", confidence: 76, zone: "Z-01", timestamp: "2 days ago, 07:20" },
  { id: "D-081", species: "Leopard", confidence: 85, zone: "Z-07", timestamp: "2 days ago, 05:55" },
  { id: "D-077", species: "Spotted Deer", confidence: 79, zone: "Z-05", timestamp: "3 days ago, 17:40" },
  { id: "D-070", species: "Asian Elephant", confidence: 90, zone: "Z-04", timestamp: "3 days ago, 22:11" },
];

const INITIAL_ALERTS = [
  {
    id: "A-018", zone: "Z-06", species: "Tiger", risk: 82, priority: "HIGH", status: "PENDING",
    reason: "Elevated nocturnal movement near the southern buffer boundary",
    recommended: "PRIORITIZE MONITORING", timestamp: "Today, 05:12",
  },
  {
    id: "A-012", zone: "Z-02", species: "Wild Boar", risk: 52, priority: "MEDIUM", status: "ACKNOWLEDGED",
    reason: "Crop-raiding pattern detected near river bend fields",
    recommended: "INCREASE PATROL FREQUENCY", timestamp: "Yesterday, 19:20",
  },
];

const NAV_ITEMS = [
  { id: "command", label: "Command Center", icon: LayoutGrid },
  { id: "wildlife", label: "Wildlife Detection", icon: Camera },
  { id: "risk", label: "Risk Intelligence", icon: ShieldAlert },
  { id: "gis", label: "GIS Map", icon: MapIcon },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "pipeline", label: "Intelligence Pipeline", icon: GitBranch },
];

const translations = {
  en: {
    nav: { command: "Command Center", wildlife: "Wildlife Detection", risk: "Risk Intelligence", gis: "GIS Map", alerts: "Alerts", pipeline: "Intelligence Pipeline" },
    theme: { dark: "Dark mode", light: "Light mode", label: "Switch to dark mode", iconLabel: "Toggle theme" },
    language: { label: "Language", english: "English", hindi: "हिन्दी" },
    accessibility: {
      button: "Accessibility",
      title: "Accessibility Tools",
      dyslexia: "Dyslexia-Friendly Font",
      speech: "Speech to Text",
      tts: "Text to Speech",
      read: "Read",
      stop: "Stop",
      pause: "Pause",
      resume: "Resume",
      unsupportedSpeech: "Speech recognition is not supported in this browser.",
      unsupportedTts: "Text-to-speech is not supported in this browser.",
      listening: "Listening…",
      ready: "Ready",
      status: "Accessibility ready",
      selectText: "Select text to read aloud",
      readSelection: "Read selection"
    },
    ui: { searchPlaceholder: "Search zone, species, alert…", runDemo: "Run KAVACH Demo", collapse: "Collapse", voice: "Voice", read: "Read", ready: "Ready" },
    alerts: { noMatches: "No matches for" },
    empty: "No results"
  },
  hi: {
    nav: { command: "कमांड सेंटर", wildlife: "वन्यजीव पता लगाना", risk: "जोखिम बोध", gis: "जीआईएस नक्शा", alerts: "अलर्ट", pipeline: "बुद्धिमत्ता पाइपलाइन" },
    theme: { dark: "डार्क मोड", light: "लाइट मोड", label: "डार्क मोड पर स्विच करें", iconLabel: "थीम बदलें" },
    language: { label: "भाषा", english: "English", hindi: "हिन्दी" },
    accessibility: {
      button: "एक्सेसिबिलिटी",
      title: "एक्सेसिबिलिटी टूल्स",
      dyslexia: "डिस्लेक्सिया-फ्रेंडली फ़ॉन्ट",
      speech: "स्पीच टू टेक्स्ट",
      tts: "टेक्स्ट टू स्पीच",
      read: "पढ़ें",
      stop: "रोकें",
      pause: "रोकें",
      resume: "फिर से शुरू करें",
      unsupportedSpeech: "इस ब्राउज़र में स्पीच रिकॉग्निशन समर्थित नहीं है।",
      unsupportedTts: "इस ब्राउज़र में टेक्स्ट-टू-स्पीच समर्थित नहीं है।",
      listening: "सुन रहा है…",
      ready: "तैयार",
      status: "एक्सेसिबिलिटी तैयार है",
      selectText: "पढ़ने के लिए टेक्स्ट चुनें",
      readSelection: "चयनित पाठ पढ़ें"
    },
    ui: { searchPlaceholder: "ज़ोन, प्रजाति, अलर्ट खोजें…", runDemo: "KAVACH डेमो चलाएँ", collapse: "संक्षिप्त करें", voice: "वॉयस", read: "पढ़ें", ready: "तैयार" },
    alerts: { noMatches: "कोई परिणाम नहीं" },
    empty: "कोई परिणाम नहीं"
  }
};

const PROCESSING_STAGES = ["INGESTING IMAGE", "RUNNING AI DETECTION", "EXTRACTING FEATURES", "DETECTION COMPLETE"];

function getStoredPreference(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const value = localStorage.getItem(key);
    return value ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function getSystemTheme() {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getTranslation(language, keyPath, fallback = "") {
  const path = keyPath.split(".");
  let current = translations[language] || translations.en;
  for (const part of path) {
    current = current?.[part];
    if (!current) return fallback;
  }
  return current;
}

/* ============================== STYLES ============================== */

const GlobalStyle = () => (
  <style>{`
    html,
body,
#root {
  margin: 0;
  padding: 0;
  width: 100%;
  min-width: 100%;
  min-height: 100vh;
  background: #050807;
}

* {
  box-sizing: border-box;
}
    @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&family=Atkinson+Hyperlegible:wght@400;700&display=swap');

    .kavach, .kavach * { box-sizing: border-box; }
    .kavach {
      --void:#0B1712; --panel:#101E18; --panel-raised:#13271F; --panel-hi:#183828;
      --line:#234634; --line-soft:#1d342c;
      --text:#EEF4EE; --text-muted:#A4B7AC; --text-dim:#7A9183;
      --amber:#D6A84F; --amber-dim:#8A6830;
      --low:#4F8A64; --medium:#D99A32; --high:#C94C4C;
      --bg: radial-gradient(circle at top left, rgba(47,107,79,0.28) 0%, rgba(11,23,18,0.85) 32%, #0B1712 100%);
      font-family:'IBM Plex Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      width: 100%;
      position: relative;
      overflow-x: hidden;
    }
    .kavach[data-theme="light"] {
      --void:#F4F1E8; --panel:#F7F4EE; --panel-raised:#FFFFFF; --panel-hi:#EFE8D8;
      --line:#D5CCB2; --line-soft:#E6E0CE;
      --text:#12372A; --text-muted:#365D4B; --text-dim:#5B7367;
      --amber:#D6A84F; --amber-dim:#C89A3E;
      --low:#4F8A64; --medium:#D99A32; --high:#C94C4C;
      --bg: linear-gradient(180deg, #F4F1E8 0%, #ECE6D8 100%);
      color: var(--text);
    }
    .kavach[data-theme="light"] .kv-panel,
    .kavach[data-theme="light"] .kv-btn,
    .kavach[data-theme="light"] .kv-accessibility-btn,
    .kavach[data-theme="light"] .kv-status-pill,
    .kavach[data-theme="light"] .kv-tag {
      box-shadow: 0 8px 18px rgba(18, 55, 42, 0.08);
    }
    .kavach[data-theme="light"] .kv-accessibility-btn {
      background: #ffffff;
      border-color: #d5ccb2;
      color: #12372A;
    }
    .kavach[data-theme="light"] .kv-accessibility-btn.is-active {
      background: rgba(214,168,79,0.12);
      border-color: #d6a84f;
      color: #6d4a11;
    }
    .kavach[data-theme="light"] .kv-status-pill {
      background: #f8f5ef;
      color: #173d2f;
      border-color: #d5ccb2;
    }
    .kavach[data-theme="light"] .kv-status-pill .dot {
      box-shadow: 0 0 12px rgba(79,138,100,0.35);
    }
    .kavach[data-high-contrast="true"] {
      --panel:#000000; --panel-raised:#111111; --panel-hi:#1a1a1a; --line:#ffffff; --line-soft:#d9d9d9;
      --text:#ffffff; --text-muted:#f2f2f2; --text-dim:#d9d9d9;
      --amber:#ffd166; --amber-dim:#ffd166; --low:#9ae6b4; --medium:#ffd166; --high:#ff7a7a;
    }
    .kavach[data-color-blind="true"] {
      --low:#3B82F6; --medium:#D97706; --high:#B91C1C;
    }
    .kavach[data-reduce-motion="true"] *,
    .kavach[data-reduce-motion="true"] *::before,
    .kavach[data-reduce-motion="true"] *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }
    .kavach.dyslexia-mode, .kavach.dyslexia-mode * {
      font-family:'Atkinson Hyperlegible', 'Lexend', 'IBM Plex Sans', sans-serif !important;
      letter-spacing: 0.01em;
    }
    .kavach.dyslexia-mode p, .kavach.dyslexia-mode div, .kavach.dyslexia-mode span, .kavach.dyslexia-mode button {
      line-height: 1.6;
    }
    .kavach .kv-display { font-family:'Rajdhani', sans-serif; letter-spacing: 0.02em; }
    .kavach .kv-mono { font-family:'IBM Plex Mono', monospace; }
    .kavach ::-webkit-scrollbar { width: 8px; height: 8px; }
    .kavach ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }
    .kavach ::-webkit-scrollbar-track { background: transparent; }
    .kavach button { font-family: inherit; cursor: pointer; }
    .kavach input, .kavach select { font-family: inherit; }
    .kavach a { color: inherit; }

    @keyframes kv-pulse {
      0% { transform: scale(0.9); opacity: 0.9; }
      70% { transform: scale(2.4); opacity: 0; }
      100% { transform: scale(2.4); opacity: 0; }
    }
    @keyframes kv-spin { to { transform: rotate(360deg); } }
    @keyframes kv-sweep { to { transform: rotate(360deg); } }
    @keyframes kv-fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes kv-slidein { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes kv-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
    .kv-fadein { animation: kv-fadein 0.35s ease both; }
    .kv-slidein { animation: kv-slidein 0.3s ease both; }

    .kv-scroll-thin::-webkit-scrollbar { width: 6px; }

    .kv-btn {
      display:inline-flex; align-items:center; gap:8px; border-radius:3px;
      padding:10px 16px; font-size:13px; font-weight:600; letter-spacing:0.04em;
      text-transform:uppercase; border:1px solid var(--line); background:var(--panel-raised);
      color:var(--text); transition: all .15s ease;
    }
    .kv-btn:hover { border-color: var(--amber-dim); background: var(--panel-hi); }
    .kv-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .kv-btn-primary { background: var(--amber); border-color: var(--amber); color:#1A1305; }
    .kv-btn-primary:hover { background:#f0b155; border-color:#f0b155; }
    .kv-btn-primary:disabled { background: var(--amber-dim); border-color: var(--amber-dim); color:#00000066;}
    .kv-btn-ghost { background:transparent; }

    .kv-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; }
    .kv-tag {
      font-family:'IBM Plex Mono', monospace; font-size:10.5px; letter-spacing:0.08em;
      padding: 3px 7px; border-radius: 2px; border: 1px solid var(--line); color: var(--text-muted);
      text-transform: uppercase; display:inline-flex; align-items:center; gap:5px;
    }

    .kv-panel {
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.02);
    }
    .kv-btn, .kv-panel, .kv-tag, input, select {
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
    }
    .kv-btn:hover, .kv-panel:hover { transform: translateY(-1px); }
    button:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid rgba(232,163,61,0.8);
      outline-offset: 2px;
      box-shadow: 0 0 0 4px rgba(232,163,61,0.12);
    }
    .kv-accessibility-toolbar {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    }
    .kv-accessibility-btn {
      display: inline-flex; align-items: center; gap: 8px; border-radius: 999px;
      padding: 8px 12px; border: 1px solid var(--line); background: rgba(23,34,26,0.9);
      color: var(--text); font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .kv-accessibility-btn.is-active {
      border-color: rgba(232,163,61,0.8); background: rgba(232,163,61,0.12); color: var(--amber);
    }
    .kv-status-pill {
      display:inline-flex; align-items:center; gap:6px; padding: 4px 8px; border-radius: 999px;
      border:1px solid var(--line); background: rgba(17,26,19,0.9); color: var(--text-muted);
      font-family:'IBM Plex Mono', monospace; font-size:10px; letter-spacing:0.08em; text-transform:uppercase;
    }
    .kv-status-pill .dot {
      width: 7px; height: 7px; border-radius: 50%; background: var(--low); display:inline-block;
      box-shadow: 0 0 12px rgba(76,175,109,0.7);
    }
    .kv-status-pill.listening .dot { background: var(--amber); box-shadow: 0 0 12px rgba(232,163,61,0.7); }
    .kv-status-pill.speaking .dot { background: var(--high); box-shadow: 0 0 12px rgba(228,85,61,0.7); }
  `}</style>
);

/* ============================== HELPERS ============================== */

export function riskVar(level) {
  if (level === "HIGH") return "var(--high)";
  if (level === "MEDIUM") return "var(--medium)";
  return "var(--low)";
}

function getRiskLevel(risk) {
  if (risk >= 70) return "HIGH";
  if (risk >= 40) return "MEDIUM";
  return "LOW";
}

function getRecommendation(risk) {
  if (risk >= 70) return "PRIORITIZE RANGER PATROL + INCREASE CAMERA MONITORING";
  if (risk >= 40) return "INCREASE PATROL FREQUENCY + MONITOR AREA";
  return "CONTINUE ROUTINE MONITORING";
}

export function RiskBadge({ level, size = "md" }) {
  const pad = size === "sm" ? "2px 7px" : "4px 10px";
  const fs = size === "sm" ? "10px" : "11px";
  return (
    <span className="kv-mono" style={{
      color: riskVar(level), border: `1px solid ${riskVar(level)}55`, background: `${riskVar(level)}14`,
      padding: pad, borderRadius: 2, fontSize: fs, letterSpacing: "0.08em", fontWeight: 600,
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: riskVar(level) }} />
      {level}
    </span>
  );
}

function FeatureLevelPill({ level }) {
  return (
    <span className="kv-mono" style={{
      color: riskVar(level), fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
      border: `1px solid ${riskVar(level)}55`, padding: "3px 9px", borderRadius: 2, background: `${riskVar(level)}10`,
    }}>{level}</span>
  );
}

function getPageSummary(page, data) {
  if (page === "command") {
    return `KAVACH command center. ${data.detections} wildlife detections logged, ${data.pendingAlerts} pending alerts, and ${data.highRiskZones} high risk zones in active monitoring.`;
  }
  if (page === "wildlife") {
    return `Wildlife detection view. ${data.detections} detections have been captured across ${data.speciesCount} species. Review recent camera trap results and the latest classification confidence scores.`;
  }
  if (page === "risk") {
    return `Risk intelligence view. The current analysis shows ${data.zoneName} with a ${data.zoneRisk} percent conflict risk score.`;
  }
  if (page === "gis") {
    return `GIS map view. Spatial hotspot monitoring is active for ${data.zoneCount} monitored zones across the reserve.`;
  }
  if (page === "alerts") {
    return `Alerts board. ${data.pendingAlerts} alerts remain pending and ${data.acknowledgedAlerts} have been acknowledged by field teams.`;
  }
  if (page === "pipeline") {
    return `Intelligence pipeline overview. Camera trap imagery flows through detection, risk scoring, and alert generation stages.`;
  }
  return "KAVACH overview.";
}

function useVoiceAccessibility() {
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(Boolean(SpeechRecognitionCtor));

    if (!SpeechRecognitionCtor) return undefined;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;

    return () => recognition.stop();
  }, []);

  const startListening = (onTranscript) => {
    if (!recognitionRef.current) {
      alert("Speech-to-text is not supported in this browser. Try a Chromium-based browser for voice dictation.");
      return;
    }

    recognitionRef.current.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join(" ")
        .trim();

      if (transcript && onTranscript) onTranscript(transcript);
    };

    recognitionRef.current.start();
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) recognitionRef.current.stop();
  };

  const speak = (text) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("Text-to-speech is not supported in this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  return { voiceSupported, isListening, isSpeaking, startListening, stopListening, speak, stopSpeaking };
}

/* ============================== APP CONTEXT ============================== */

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function AppProvider({ children }) {
  const [page, setPage] = useState("command");
  const [detections, setDetections] = useState(INITIAL_DETECTIONS);
  const [alerts, setAlerts] = useState(() => {
    const storedAlerts = getStoredPreference("kavach-alerts", JSON.stringify(INITIAL_ALERTS));
    try {
      const parsed = JSON.parse(storedAlerts);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_ALERTS;
    } catch (error) {
      return INITIAL_ALERTS;
    }
  });

  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [gisRiskFilter, setGisRiskFilter] = useState("all");
  const [gisSpeciesFilter, setGisSpeciesFilter] = useState("all");
  const [alertPriorityFilter, setAlertPriorityFilter] = useState("all");
  const [riskResult, setRiskResult] = useState(null);
  const [alertStatusFilter, setAlertStatusFilter] = useState("all");
  const [highlightAlertId, setHighlightAlertId] = useState(null);

  const [detectionZoneFilter, setDetectionZoneFilter] = useState("all");
  const [detectionSpeciesFilter, setDetectionSpeciesFilter] = useState("all");
  const [highlightDetectionId, setHighlightDetectionId] = useState(null);

  const [pendingRiskZoneId, setPendingRiskZoneId] = useState("Z-04");
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("kavach-alerts", JSON.stringify(alerts));
  }, [alerts]);

  const [theme, setTheme] = useState(() => {
    const stored = getStoredPreference("kavach-theme", getSystemTheme());
    return stored === "light" || stored === "dark" ? stored : "dark";
  });
  const [language, setLanguage] = useState(() => getStoredPreference("kavach-language", "en"));
  const [dyslexiaFont, setDyslexiaFont] = useState(() => getStoredPreference("kavach-dyslexia-font", "false") === "true");
  const [fontScale, setFontScale] = useState(() => Number(getStoredPreference("kavach-font-scale", "1")) || 1);
  const [highContrast, setHighContrast] = useState(() => getStoredPreference("kavach-high-contrast", "false") === "true");
  const [colorBlindMode, setColorBlindMode] = useState(() => getStoredPreference("kavach-color-blind", "false") === "true");
  const [reduceMotion, setReduceMotion] = useState(() => getStoredPreference("kavach-reduce-motion", "false") === "true");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kavach-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dyslexia-mode", dyslexiaFont);
    localStorage.setItem("kavach-dyslexia-font", String(dyslexiaFont));
  }, [dyslexiaFont]);

  useEffect(() => {
    localStorage.setItem("kavach-language", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("kavach-font-scale", String(fontScale));
    document.documentElement.setAttribute("data-font-scale", String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    localStorage.setItem("kavach-high-contrast", String(highContrast));
    document.documentElement.setAttribute("data-high-contrast", String(highContrast));
  }, [highContrast]);

  useEffect(() => {
    localStorage.setItem("kavach-color-blind", String(colorBlindMode));
    document.documentElement.setAttribute("data-color-blind", String(colorBlindMode));
  }, [colorBlindMode]);

  useEffect(() => {
    localStorage.setItem("kavach-reduce-motion", String(reduceMotion));
    document.documentElement.setAttribute("data-reduce-motion", String(reduceMotion));
  }, [reduceMotion]);

  function navigate(target, opts = {}) {
    setPage(target);
    if (opts.zoneId !== undefined) setSelectedZoneId(opts.zoneId);
    if (opts.gisRiskFilter !== undefined) setGisRiskFilter(opts.gisRiskFilter);
    if (opts.gisSpeciesFilter !== undefined) setGisSpeciesFilter(opts.gisSpeciesFilter);
    if (opts.alertPriorityFilter !== undefined) setAlertPriorityFilter(opts.alertPriorityFilter);
    if (opts.alertStatusFilter !== undefined) setAlertStatusFilter(opts.alertStatusFilter);
    if (opts.highlightAlertId !== undefined) setHighlightAlertId(opts.highlightAlertId);
    if (opts.detectionZoneFilter !== undefined) setDetectionZoneFilter(opts.detectionZoneFilter);
    if (opts.detectionSpeciesFilter !== undefined) setDetectionSpeciesFilter(opts.detectionSpeciesFilter);
    if (opts.highlightDetectionId !== undefined) setHighlightDetectionId(opts.highlightDetectionId);
    if (opts.riskZoneId !== undefined) setPendingRiskZoneId(opts.riskZoneId);
  }

  function addDetection(det) {
    setDetections(prev => [det, ...prev]);
  }

  function createAlertForZone(zoneId) {
    const zone = ZONE_BY_ID[zoneId];
    const id = nextId("A");
    const alert = {
      id, zone: zone.id, species: zone.species, risk: zone.risk,
      priority: getRiskLevel(zone.risk), status: "PENDING",
      reason: `Elevated ${zone.factors.wildlifeActivity.toLowerCase()} wildlife activity near ${zone.settlementProximity.toLowerCase()} settlement proximity`,
      recommended: getRecommendation(zone.risk), timestamp: "Just now",
    };
    setAlerts(prev => [alert, ...prev]);
    return alert;
  }

  function acknowledgeAlert(id) {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: "ACKNOWLEDGED" } : a));
  }

  const pendingAlertCount = alerts.filter(a => a.status === "PENDING").length;
  const highRiskZoneCount = ZONES.filter(z => z.riskLevel === "HIGH").length;
  const activeRiskZoneCount = ZONES.filter(z => z.riskLevel !== "LOW").length;

  const value = {
    page, navigate,
    detections, addDetection,
    alerts, createAlertForZone, acknowledgeAlert,
    selectedZoneId, setSelectedZoneId,
    gisRiskFilter, setGisRiskFilter, gisSpeciesFilter, setGisSpeciesFilter,
    alertPriorityFilter, setAlertPriorityFilter, alertStatusFilter, setAlertStatusFilter,
    highlightAlertId, setHighlightAlertId,
    detectionZoneFilter, setDetectionZoneFilter, detectionSpeciesFilter, setDetectionSpeciesFilter,
    highlightDetectionId, setHighlightDetectionId,
    pendingRiskZoneId, setPendingRiskZoneId,
    riskResult, setRiskResult,
    demoOpen, setDemoOpen,
    pendingAlertCount, highRiskZoneCount, activeRiskZoneCount,
    theme, setTheme,
    language, setLanguage,
    dyslexiaFont, setDyslexiaFont,
    fontScale, setFontScale,
    highContrast, setHighContrast,
    colorBlindMode, setColorBlindMode,
    reduceMotion, setReduceMotion,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ============================== SHELL ============================== */

function ThemeToggle() {
  const { theme, setTheme, language } = useApp();
  const isDark = theme === "dark";
  const label = isDark ? getTranslation(language, "theme.light") : getTranslation(language, "theme.dark");
  const ariaLabel = isDark ? `${getTranslation(language, "theme.label").replace("Switch to dark mode", "Switch to light mode")}` : getTranslation(language, "theme.label");

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="kv-btn kv-btn-ghost"
      style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "8px 12px" }}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
      <span>{label}</span>
    </button>
  );
}

function LanguageSelector() {
  const { language, setLanguage } = useApp();
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 600 }}>
      <span aria-hidden="true">🌐</span>
      <select
        aria-label="Select application language"
        value={language}
        onChange={e => setLanguage(e.target.value)}
        style={{ ...selStyle, minWidth: 110, borderRadius: 999, background: "var(--panel-raised)", padding: "8px 10px" }}
      >
        <option value="en">English</option>
        <option value="hi">हिन्दी</option>
      </select>
    </label>
  );
}

function AccessibilityPanel({ open, onClose }) {
  const {
    language, dyslexiaFont, setDyslexiaFont, fontScale, setFontScale,
    highContrast, setHighContrast, colorBlindMode, setColorBlindMode,
    reduceMotion, setReduceMotion
  } = useApp();
  const [status, setStatus] = useState("Ready");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef(null);
  const t = translations[language] || translations.en;

  const resetSettings = () => {
    setDyslexiaFont(false);
    setFontScale(1);
    setHighContrast(false);
    setColorBlindMode(false);
    setReduceMotion(false);
    setStatus("Settings reset");
  };

  useEffect(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = language === "hi" ? "hi-IN" : "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setStatus(t.accessibility.unsupportedSpeech);
    };
    recognition.onresult = event => {
      const transcript = Array.from(event.results)
        .map(result => result[0]?.transcript ?? "")
        .join(" ")
        .trim();

      if (transcript) {
        setStatus(transcript);
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
          const start = active.selectionStart ?? active.value.length;
          const end = active.selectionEnd ?? active.value.length;
          const nextValue = `${active.value.slice(0, start)}${transcript}${active.value.slice(end)}`;
          active.value = nextValue;
          active.dispatchEvent(new Event("input", { bubbles: true }));
          active.focus();
          active.setSelectionRange(start + transcript.length, start + transcript.length);
        }
      }
    };

    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, [language]);

  const toggleDyslexia = () => setDyslexiaFont(v => !v);

  const startSpeechRecognition = () => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setStatus(t.accessibility.unsupportedSpeech);
      return;
    }

    if (!recognitionRef.current) {
      setStatus(t.accessibility.unsupportedSpeech);
      return;
    }

    setStatus(t.accessibility.listening);
    recognitionRef.current.start();
  };

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setListening(false);
    setStatus(t.accessibility.ready);
  };

  const speakText = () => {
    if (!("speechSynthesis" in window)) {
      setStatus(t.accessibility.unsupportedTts);
      return;
    }
    const selectedText = window.getSelection()?.toString()?.trim();
    const textToSpeak = selectedText || `KAVACH dashboard. ${document.title || "Application summary"}`;
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = language === "hi" ? "hi-IN" : "en-US";
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setStatus(t.accessibility.reading || "Reading");
  };

  const pauseSpeech = () => {
    if (!("speechSynthesis" in window)) return;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume(); else window.speechSynthesis.pause();
  };

  const stopSpeech = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setStatus(t.accessibility.ready);
  };

  if (!open) return null;

  return (
    <div className="kv-panel kv-fadein" style={{ position: "fixed", right: 26, bottom: 92, width: 300, zIndex: 90, padding: 18, background: "var(--panel)", borderColor: "var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="kv-display" style={{ fontSize: 18, fontWeight: 700 }}>{t.accessibility.title}</div>
        <button type="button" aria-label="Close accessibility panel" onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-dim)" }}><X size={16} /></button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Readability</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <button type="button" aria-label="Decrease text size" onClick={() => setFontScale(s => Math.max(0.9, +(s - 0.1).toFixed(2)))} className="kv-accessibility-btn" style={{ flex: 1, justifyContent: "center" }}>A−</button>
            <button type="button" aria-label="Reset text size" onClick={() => setFontScale(1)} className="kv-accessibility-btn" style={{ flex: 1, justifyContent: "center" }}>A</button>
            <button type="button" aria-label="Increase text size" onClick={() => setFontScale(s => Math.min(1.3, +(s + 0.1).toFixed(2)))} className="kv-accessibility-btn" style={{ flex: 1, justifyContent: "center" }}>A+</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 8, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
            <span style={{ fontSize: 13 }}>{t.accessibility.dyslexia}</span>
            <button type="button" aria-label={dyslexiaFont ? "Disable dyslexia-friendly font" : "Enable dyslexia-friendly font"} onClick={toggleDyslexia} className={`kv-accessibility-btn ${dyslexiaFont ? "is-active" : ""}`} style={{ padding: "6px 10px", borderRadius: 999 }}>
              {dyslexiaFont ? "On" : "Off"}
            </button>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Voice</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" aria-label={listening ? "Stop speech to text" : "Start speech to text"} onClick={listening ? stopSpeechRecognition : startSpeechRecognition} className={`kv-accessibility-btn ${listening ? "is-active" : ""}`} style={{ justifyContent: "center" }}>
              {listening ? <MicOff size={14} /> : <Mic size={14} />} {listening ? "Stop" : t.accessibility.speech}
            </button>

            <button type="button" aria-label="Play text to speech" onClick={speakText} className="kv-accessibility-btn" style={{ justifyContent: "center" }}>
              <Volume2 size={14} /> {t.accessibility.tts}
            </button>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Visual</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
              <span style={{ fontSize: 12 }}>High Contrast</span>
              <button type="button" aria-label={highContrast ? "Disable high contrast" : "Enable high contrast"} onClick={() => setHighContrast(v => !v)} className={`kv-accessibility-btn ${highContrast ? "is-active" : ""}`} style={{ padding: "6px 10px", borderRadius: 999 }}>
                {highContrast ? "ON" : "OFF"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
              <span style={{ fontSize: 12 }}>Color Blind Friendly</span>
              <button type="button" aria-label={colorBlindMode ? "Disable color blind mode" : "Enable color blind mode"} onClick={() => setColorBlindMode(v => !v)} className={`kv-accessibility-btn ${colorBlindMode ? "is-active" : ""}`} style={{ padding: "6px 10px", borderRadius: 999 }}>
                {colorBlindMode ? "ON" : "OFF"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
              <span style={{ fontSize: 12 }}>Reduce Motion</span>
              <button type="button" aria-label={reduceMotion ? "Disable reduced motion" : "Enable reduced motion"} onClick={() => setReduceMotion(v => !v)} className={`kv-accessibility-btn ${reduceMotion ? "is-active" : ""}`} style={{ padding: "6px 10px", borderRadius: 999 }}>
                {reduceMotion ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <button type="button" aria-label="Reset accessibility settings" onClick={resetSettings} className="kv-btn kv-btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
        ↻ Reset Settings
      </button>

      <div className="kv-status-pill" style={{ marginTop: 12, width: "100%", justifyContent: "center" }}>
        <span className={`dot ${listening ? "listening" : speaking ? "speaking" : ""}`} /> {status}
      </div>
    </div>
  );
}

function AccessibilityButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Open accessibility tools"
        onClick={() => setOpen(v => !v)}
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          zIndex: 100,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "1px solid var(--amber-dim)",
          background: "linear-gradient(135deg, var(--amber), #f5d38d)",
          color: "#1A1305",
          boxShadow: "0 14px 28px rgba(232,163,61,0.28)",
          cursor: "pointer"
        }}
      >
        <Accessibility size={22} />
      </button>
      <AccessibilityPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Sidebar({ collapsed, setCollapsed }) {
  const { page, navigate, language } = useApp();
  const translatedNav = NAV_ITEMS.map(item => ({ ...item, label: getTranslation(language, `nav.${item.id}`) }));
  return (
    <div style={{
      width: collapsed ? 68 : 232, flexShrink: 0, background: "var(--panel)",
      borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column",
      transition: "width .2s ease", height: "100%",
    }}>
      <div style={{ padding: collapsed ? "20px 0" : "22px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, justifyContent: collapsed ? "center" : "flex-start" }}>
        <div style={{ width: 34, height: 34, borderRadius: 4, background: "linear-gradient(135deg, var(--amber), #b5761f)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <ShieldAlert size={19} color="#1A1305" />
        </div>
        {!collapsed && (
          <div>
            <div className="kv-display" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1 }}>KAVACH</div>
            <div className="kv-mono" style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.1em", marginTop: 3 }}>EARLY-WARNING SYSTEM</div>
          </div>
        )}
      </div>
      <nav style={{ padding: "14px 10px", display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
        {translatedNav.map(item => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button key={item.id} onClick={() => navigate(item.id)} title={collapsed ? item.label : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: collapsed ? "11px 0" : "11px 12px",
                justifyContent: collapsed ? "center" : "flex-start",
                borderRadius: 3, border: "none", background: active ? "var(--panel-hi)" : "transparent",
                borderLeft: active ? "2px solid var(--amber)" : "2px solid transparent",
                color: active ? "var(--text)" : "var(--text-muted)", textAlign: "left",
                fontSize: 13, fontWeight: active ? 600 : 500, transition: "all .15s ease",
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--panel-raised)"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <Icon size={16} strokeWidth={2} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>
      <button onClick={() => setCollapsed(c => !c)} className="kv-btn kv-btn-ghost" style={{ margin: 10, justifyContent: "center", borderColor: "var(--line-soft)" }}>
        <Menu size={14} />
        {!collapsed && <span style={{ fontSize: 11 }}>{getTranslation(language, "ui.collapse", "Collapse")}</span>}
      </button>
    </div>
  );
}

function GlobalSearch() {
  const { navigate } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { startListening, isListening, voiceSupported, stopListening } = useVoiceAccessibility();

  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const dynamicResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    ZONES.forEach(z => {
      if (z.name.toLowerCase().includes(q) || z.id.toLowerCase().includes(q)) {
        out.push({ type: "ZONE", label: `${z.id} · ${z.name}`, sub: `${z.species} · ${z.riskLevel}`, action: () => { navigate("gis", { zoneId: z.id, gisRiskFilter: "all", gisSpeciesFilter: "all" }); setOpen(false); setQuery(""); } });
      }
    });
    SPECIES_LIST.forEach(sp => {
      if (sp.toLowerCase().includes(q)) {
        out.push({ type: "SPECIES", label: sp, sub: "Filter GIS map", action: () => { navigate("gis", { gisSpeciesFilter: sp, gisRiskFilter: "all", zoneId: null }); setOpen(false); setQuery(""); } });
      }
    });
    return out.slice(0, 8);
  }, [query, navigate]);

  const handleVoiceInput = (transcript) => {
    const cleaned = transcript.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    setQuery(cleaned);
    setOpen(true);
  };

  return (
    <div ref={ref} style={{ position: "relative", width: 360 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel-raised)", border: "1px solid var(--line)", borderRadius: 999, padding: "8px 12px" }}>
        <Search size={14} color="var(--text-dim)" />
        <input
          aria-label="Search wildlife intelligence"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search zone, species, alert…"
          style={{ background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: 13, width: "100%" }}
        />
        {voiceSupported && (
          <button
            type="button"
            aria-label={isListening ? "Stop voice search" : "Search using voice"}
            onClick={() => isListening ? stopListening() : startListening(handleVoiceInput)}
            className={`kv-accessibility-btn ${isListening ? "is-active" : ""}`}
            style={{ padding: "6px 8px", borderRadius: "50%", width: 32, height: 32, justifyContent: "center" }}
          >
            {isListening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )}
        {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")} style={{ background: "transparent", border: "none", display: "flex", padding: 0, color: "var(--text-dim)" }}><X size={13} /></button>}
      </div>
      {open && query && (
        <div className="kv-panel kv-fadein" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50, maxHeight: 280, overflowY: "auto", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>
          {dynamicResults.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: "var(--text-dim)" }}>No matches for "{query}"</div>}
          {dynamicResults.map((r, i) => (
            <button key={i} onClick={r.action} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "transparent", border: "none", borderBottom: "1px solid var(--line-soft)", textAlign: "left" }}>
              <div>
                <div style={{ fontSize: 13, color: "var(--text)" }}>{r.label}</div>
                <div className="kv-mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{r.sub}</div>
              </div>
              <span className="kv-tag">{r.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Header() {
  const { page, setDemoOpen, detections, alerts, highRiskZoneCount, pendingAlertCount, theme, language } = useApp();
  const current = NAV_ITEMS.find(n => n.id === page);
  const { speak, stopSpeaking, isSpeaking } = useVoiceAccessibility();

  const summary = getPageSummary(page, {
    detections: detections.length,
    pendingAlerts: pendingAlertCount,
    highRiskZones: highRiskZoneCount,
    acknowledgedAlerts: alerts.filter(a => a.status === "ACKNOWLEDGED").length,
    speciesCount: [...new Set(detections.map(d => d.species))].length,
    zoneName: ZONES[3].name,
    zoneRisk: ZONES[3].risk,
    zoneCount: ZONES.length,
  });

  return (
    <div style={{ padding: "18px 28px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, background: "rgba(10,16,12,0.7)", backdropFilter: "blur(6px)" }}>
      <div>
        <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.12em", marginBottom: 3 }}>KAVACH / {current?.id.toUpperCase()}</div>
        <div className="kv-display" style={{ fontSize: 22, fontWeight: 700 }}>{getTranslation(language, `nav.${page}`, current?.label)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <GlobalSearch />
        <ThemeToggle />
        <LanguageSelector />
        <div className="kv-accessibility-toolbar">
          <button type="button" aria-label={isSpeaking ? "Stop text to speech" : "Read page summary aloud"} onClick={() => isSpeaking ? stopSpeaking() : speak(summary)} className={`kv-accessibility-btn ${isSpeaking ? "is-active" : ""}`}>
            {isSpeaking ? <VolumeX size={13} /> : <Volume2 size={13} />} {isSpeaking ? "Stop" : "Read"}
          </button>
          <div className={`kv-status-pill ${isSpeaking ? "speaking" : ""}`}>
            <span className="dot" /> {isSpeaking ? "Speaking" : "Ready"}
          </div>
        </div>
        <button className="kv-btn kv-btn-primary" onClick={() => setDemoOpen(true)}>
          <Play size={13} /> {getTranslation(language, "ui.runDemo", "Run KAVACH Demo")}
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const { page, demoOpen, theme, dyslexiaFont, highContrast, colorBlindMode, reduceMotion, fontScale } = useApp();

  useEffect(() => {
    function handle() { setCollapsed(window.innerWidth < 980); }
    handle();
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  return (
    <div
      className={`kavach ${dyslexiaFont ? "dyslexia-mode" : ""}`}
      data-theme={theme}
      data-high-contrast={String(highContrast)}
      data-color-blind={String(colorBlindMode)}
      data-reduce-motion={String(reduceMotion)}
      style={{ display: "flex", minHeight: "100vh", fontSize: `${fontScale}em` }}
    >
      <GlobalStyle />
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Header />
        <div style={{ padding: "26px 28px 60px", flex: 1 }}>
          {page === "command" && <CommandCenter />}
          {page === "wildlife" && <WildlifeDetection />}
          {page === "risk" && <RiskIntelligence />}
          {page === "gis" && <GISMap />}
          {page === "alerts" && <AlertsPage />}
          {page === "pipeline" && <PipelinePage />}
        </div>
      </div>
      {demoOpen && <DemoModal />}
      <AccessibilityButton />
    </div>
  );
}

/* ============================== COMMAND CENTER ============================== */

function KPICard({ label, value, icon: Icon, accent, onClick, sub }) {
  return (
    <button onClick={onClick} className="kv-panel kv-fadein" style={{
      padding: 20, textAlign: "left", display: "flex", flexDirection: "column", gap: 14,
      transition: "all .15s ease", position: "relative", overflow: "hidden",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ width: 34, height: 34, borderRadius: 3, background: `${accent}18`, border: `1px solid ${accent}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={16} color={accent} />
        </div>
        <ChevronRight size={15} color="var(--text-dim)" />
      </div>
      <div>
        <div className="kv-display" style={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: "var(--text)" }}>{value}</div>
        <div className="kv-mono" style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em", marginTop: 8, textTransform: "uppercase" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 4 }}>{sub}</div>}
      </div>
    </button>
  );
}

function CommandCenter() {
  const { navigate, detections, alerts, activeRiskZoneCount, highRiskZoneCount, pendingAlertCount } = useApp();
  const recentAlerts = alerts.slice(0, 4);

  return (
    <div className="kv-fadein">
      <div className="kv-panel" style={{ padding: "28px 30px", marginBottom: 22, position: "relative", overflow: "hidden", background: "linear-gradient(135deg, rgba(214,168,79,0.10), rgba(18,55,42,0.14) 35%, rgba(11,23,18,0.88) 100%)" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 15% 15%, rgba(79,138,100,0.24), transparent 20%), radial-gradient(circle at 70% 20%, rgba(214,168,79,0.14), transparent 18%), linear-gradient(120deg, rgba(18,55,42,0.12), rgba(11,23,18,0.2))", pointerEvents: "none" }} />
        <div style={{ position: "absolute", inset: "18px 0 0 0", background: "linear-gradient(rgba(255,255,255,0.02), transparent), repeating-linear-gradient(90deg, transparent 0 42px, rgba(157,174,164,0.08) 42px 43px), repeating-linear-gradient(180deg, transparent 0 42px, rgba(157,174,164,0.04) 42px 43px)", opacity: 0.7, pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="kv-tag" style={{ marginBottom: 12 }}><Radio size={11} /> DECISION-SUPPORT PROTOTYPE</div>
          <div className="kv-display" style={{ fontSize: 28, fontWeight: 700, maxWidth: 640, lineHeight: 1.15 }}>
            Predictive wildlife conflict intelligence, built for field action.
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 10, maxWidth: 560, lineHeight: 1.6 }}>
            KAVACH links camera-trap detection, historical conflict data and settlement proximity into a single
            early-warning pipeline — flagging high-risk corridors before an encounter occurs. Final decisions remain
            with trained conservation professionals.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            <button className="kv-btn kv-btn-primary" onClick={() => navigate("gis", { zoneId: "Z-04", gisRiskFilter: "all", gisSpeciesFilter: "all" })}>
              <MapIcon size={13} /> VIEW HOTSPOTS
            </button>
            <button className="kv-btn kv-btn-ghost" onClick={() => navigate("alerts", { alertStatusFilter: "all", alertPriorityFilter: "all" })}>
              <BellRing size={13} /> REVIEW ALERTS
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 24 }}>
        <KPICard label="Wildlife Detections" value={detections.length} icon={Camera} accent="#5AA9E6"
          sub="All logged camera-trap detections"
          onClick={() => navigate("wildlife", { detectionZoneFilter: "all", detectionSpeciesFilter: "all", highlightDetectionId: null })} />
        <KPICard label="Active Risk Zones" value={activeRiskZoneCount} icon={Activity} accent="var(--medium)"
          sub="Medium + high risk corridors"
          onClick={() => navigate("gis", { gisRiskFilter: "active", gisSpeciesFilter: "all", zoneId: null })} />
        <KPICard label="High-Risk Zones" value={highRiskZoneCount} icon={AlertTriangle} accent="var(--high)"
          sub="Zones flagged HIGH this cycle"
          onClick={() => navigate("gis", { gisRiskFilter: "high", gisSpeciesFilter: "all", zoneId: null })} />
        <KPICard label="Pending Alerts" value={pendingAlertCount} icon={BellRing} accent="var(--amber)"
          sub="Awaiting acknowledgement"
          onClick={() => navigate("alerts", { alertStatusFilter: "pending", alertPriorityFilter: "all" })} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
        <div className="kv-panel" style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="kv-display" style={{ fontSize: 16, fontWeight: 700 }}>ZONE RISK OVERVIEW</div>
            <button className="kv-btn kv-btn-ghost" onClick={() => navigate("gis", { zoneId: null, gisRiskFilter: "all", gisSpeciesFilter: "all" })} style={{ fontSize: 11, padding: "6px 10px" }}>
              OPEN GIS MAP <ArrowRight size={12} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ZONES.map(z => (
              <button key={z.id} onClick={() => navigate("gis", { zoneId: z.id, gisRiskFilter: "all", gisSpeciesFilter: "all" })}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--panel-raised)", border: "1px solid var(--line-soft)", borderRadius: 3, textAlign: "left" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--line)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--line-soft)"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="kv-mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{z.id}</span>
                  <span style={{ fontSize: 13 }}>{z.name}</span>
                  <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>· {z.species}</span>
                </div>
                <RiskBadge level={z.riskLevel} size="sm" />
              </button>
            ))}
          </div>
        </div>

        <div className="kv-panel" style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="kv-display" style={{ fontSize: 16, fontWeight: 700 }}>RECENT ALERTS</div>
            <button className="kv-btn kv-btn-ghost" onClick={() => navigate("alerts", { alertStatusFilter: "all", alertPriorityFilter: "all" })} style={{ fontSize: 11, padding: "6px 10px" }}>
              VIEW ALL <ArrowRight size={12} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recentAlerts.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>No alerts yet — run the demo to generate one.</div>}
            {recentAlerts.map(a => (
              <button key={a.id} onClick={() => navigate("alerts", { alertStatusFilter: "all", alertPriorityFilter: "all", highlightAlertId: a.id })}
                style={{ padding: "10px 12px", background: "var(--panel-raised)", border: "1px solid var(--line-soft)", borderRadius: 3, textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="kv-mono" style={{ fontSize: 11 }}>{a.id} · {a.zone}</span>
                  <RiskBadge level={a.priority} size="sm" />
                </div>
                <div style={{ fontSize: 12.5, marginTop: 6, color: "var(--text-muted)" }}>{a.species} — {a.status}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== WILDLIFE DETECTION ============================== */

function WildlifeDetection() {
  const {
    addDetection,
    navigate,
    detections,
    detectionZoneFilter,
    setDetectionZoneFilter,
    detectionSpeciesFilter,
    setDetectionSpeciesFilter,
    highlightDetectionId,
    setHighlightDetectionId,
    setRiskResult
  } = useApp();

  const [selectedImageId, setSelectedImageId] = useState(null);
  const [uploadedName, setUploadedName] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [stageIdx, setStageIdx] = useState(-1);
  const [result, setResult] = useState(null);
  const timers = useRef([]);
  const fileInputRef = useRef(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const activeSource = uploadedName
    ? { label: uploadedName, species: DEMO_IMAGES[0].species, confidence: DEMO_IMAGES[0].confidence, zone: DEMO_IMAGES[0].zone, uploaded: true }
    : DEMO_IMAGES.find(d => d.id === selectedImageId);

  function pickDemo(id) {
    setUploadedName(null);
    setUploadedFile(null);
    setSelectedImageId(id);
    setResult(null);
    setRiskResult(null);
  }
  function handleUpload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSelectedImageId(null);
    setUploadedName(f.name);
    setUploadedFile(f);
    setResult(null);
    setRiskResult(null);
  }

async function analyze() {
  if (!activeSource) return;

  setAnalyzing(true);
  setResult(null);
  setRiskResult(null);
  setStageIdx(0);

  PROCESSING_STAGES.forEach((_, i) => {
    if (i === 0) return;

    const t = setTimeout(() => setStageIdx(i), i * 650);
    timers.current.push(t);
  });

  const stageDuration = PROCESSING_STAGES.length * 650;

  try {
    let species;
    let confidence;
    let zone;

    // =========================
    // STEP 1: YOLO DETECTION
    // =========================

    if (uploadedFile) {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const response = await fetch(`${API_BASE_URL}/predict`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`YOLO backend returned ${response.status}`);
      }

      const data = await response.json();

      const best = (data.detections || [])[0];

      species = best ? best.species : "No Detection";
      confidence = best ? Number(best.confidence) : 0;

      zone =
        ZONES.find(z => z.species === species) ||
        ZONES[0];

    } else {

      // =========================
      // DEMO IMAGE
      // =========================

      species = activeSource.species;
      confidence = Number(activeSource.confidence);

      zone =
        ZONES.find(z => z.id === activeSource.zone) ||
        ZONES[0];
    }

    // =========================
    // STEP 2: CONVERT FEATURES
    // =========================

    const levelToNumber = (level) => {
      if (level === "HIGH") return 2;
      if (level === "MEDIUM") return 1;
      return 0;
    };

    const riskInput = {
      species: species,

      yolo_confidence: confidence,

      recent_detections: zone.recentDetections,

      historical_conflicts: zone.historicalConflicts,

      settlement_proximity:
        levelToNumber(zone.factors.settlementProximity),

      temporal_pattern:
        levelToNumber(zone.factors.temporalPattern),

      environmental_context:
        levelToNumber(zone.factors.environmentalContext),

      spatial_relationship:
        levelToNumber(zone.factors.spatialRelationship)
    };

    console.log("RISK INPUT:", riskInput);

    // =========================
    // STEP 3: ML RISK PREDICTION
    // =========================

    const riskResponse = await fetch(`${API_BASE_URL}/risk`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify(riskInput)
    });

    if (!riskResponse.ok) {
      throw new Error(
        `Risk backend returned ${riskResponse.status}`
      );
    }

    const riskData = await riskResponse.json();

    console.log("RISK RESULT:", riskData);

    // =========================
    // STEP 4: SAVE RISK RESULT
    // =========================

    const riskScore = Number(riskData.risk_score);

    const riskLevel =
      riskData.risk_level ||
      getRiskLevel(riskScore);

    setRiskResult({
      score: riskScore,
      level: riskLevel
    });

    // =========================
    // STEP 5: SAVE DETECTION
    // =========================

    const id = nextId("D");

    const det = {
      id,

      species,

      confidence: Math.round(confidence),

      zone: zone.id,

      timestamp: "Just now",

      risk: riskScore,

      riskLevel: riskLevel
    };

    setResult(det);

    addDetection(det);

    // =========================
    // FINISH ANIMATION
    // =========================

    await new Promise(resolve =>
      setTimeout(resolve, stageDuration)
    );

    setStageIdx(PROCESSING_STAGES.length - 1);

    setAnalyzing(false);

  } catch (err) {

    console.error("KAVACH analysis failed:", err);

    setAnalyzing(false);

    window.alert(
      `KAVACH analysis failed.\n\n${err.message}`
    );
  }
}

  const filteredDetections = detections.filter(d =>
    (detectionZoneFilter === "all" || d.zone === detectionZoneFilter) &&
    (detectionSpeciesFilter === "all" || d.species === detectionSpeciesFilter)
  );

  return (
    <div className="kv-fadein" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
      <div className="kv-panel" style={{ padding: 22 }}>
        <div className="kv-display" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>1 · SELECT INPUT</div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 16 }}>Upload a camera-trap image or choose a demo capture.</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          {DEMO_IMAGES.map(img => {
            const active = selectedImageId === img.id;
            return (
              <button key={img.id} onClick={() => pickDemo(img.id)}
                style={{
                  padding: 12, borderRadius: 3, border: `1px solid ${active ? "var(--amber)" : "var(--line-soft)"}`,
                  background: active ? "rgba(232,163,61,0.08)" : "var(--panel-raised)", textAlign: "left", display: "flex", flexDirection: "column", gap: 8,
                }}>
                <div style={{ width: "100%", height: 56, borderRadius: 3, background: "repeating-linear-gradient(45deg, #182419, #182419 6px, #14201700 6px, #14201700 12px)", border: "1px solid var(--line-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Camera size={18} color="var(--text-dim)" />
                </div>
                <div className="kv-mono" style={{ fontSize: 10.5 }}>{img.label}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{img.desc}</div>
              </button>
            );
          })}
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} />
        <button className="kv-btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => fileInputRef.current?.click()}>
          <Upload size={13} /> {uploadedName ? uploadedName : "UPLOAD YOUR OWN IMAGE"}
        </button>

        <button className="kv-btn kv-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} disabled={!activeSource || analyzing} onClick={analyze}>
          <ScanLine size={14} /> ANALYZE IMAGE
        </button>

        {analyzing && (
          <div className="kv-panel kv-fadein" style={{ marginTop: 16, padding: 16, background: "var(--panel-raised)" }}>
            {PROCESSING_STAGES.map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", opacity: i <= stageIdx ? 1 : 0.35 }}>
                {i < stageIdx ? <CheckCircle2 size={14} color="var(--low)" /> : i === stageIdx ? <RefreshCw size={14} color="var(--amber)" style={{ animation: "kv-spin 1s linear infinite" }} /> : <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid var(--line)" }} />}
                <span className="kv-mono" style={{ fontSize: 11.5 }}>{s}</span>
              </div>
            ))}
          </div>
        )}

        {result && !analyzing && (
          <div className="kv-panel kv-fadein" style={{ marginTop: 16, padding: 18, borderColor: "var(--amber-dim)" }}>
            <div className="kv-tag" style={{ marginBottom: 10 }}>DEMO MODEL OUTPUT</div>
            <div className="kv-display" style={{ fontSize: 22, fontWeight: 700 }}>{result.species.toUpperCase()}</div>
            <div className="kv-mono" style={{ color: "var(--amber)", fontSize: 14, marginTop: 2 }}>{result.confidence}% CONFIDENCE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <div><div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>ZONE</div><div style={{ fontSize: 13 }}>{result.zone} · {ZONE_BY_ID[result.zone].name}</div></div>
              <div><div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>TIMESTAMP</div><div style={{ fontSize: 13 }}>{result.timestamp}</div></div>
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={13} color="var(--low)" /><span className="kv-mono" style={{ fontSize: 11, color: "var(--low)" }}>DETECTION COMPLETE</span>
            </div>
            <button className="kv-btn kv-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
              onClick={() => navigate("risk", { riskZoneId: result.zone })}>
              ANALYZE CONFLICT RISK <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="kv-panel" style={{ padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="kv-display" style={{ fontSize: 16, fontWeight: 700 }}>DETECTION HISTORY</div>
          <span className="kv-tag">DEMO DATA</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <select value={detectionSpeciesFilter} onChange={e => setDetectionSpeciesFilter(e.target.value)} style={selStyle}>
            <option value="all">All species</option>
            {SPECIES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={detectionZoneFilter} onChange={e => setDetectionZoneFilter(e.target.value)} style={selStyle}>
            <option value="all">All zones</option>
            {ZONES.map(z => <option key={z.id} value={z.id}>{z.id} · {z.name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto" }}>
          {filteredDetections.map(d => (
            <div key={d.id} onClick={() => setHighlightDetectionId(d.id)}
              style={{
                padding: "12px 14px", borderRadius: 3, border: `1px solid ${highlightDetectionId === d.id ? "var(--amber)" : "var(--line-soft)"}`,
                background: "var(--panel-raised)", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
              }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{d.species}</div>
                <div className="kv-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 3 }}>{d.id} · {d.zone} · {d.timestamp}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="kv-mono" style={{ fontSize: 13, color: "var(--amber)" }}>{d.confidence}%</div>
                <button onClick={(e) => { e.stopPropagation(); navigate("risk", { riskZoneId: d.zone }); }} style={{ background: "transparent", border: "none", color: "var(--text-dim)", fontSize: 10.5, marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
                  ANALYZE <ArrowRight size={10} />
                </button>
              </div>
            </div>
          ))}
          {filteredDetections.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>No detections match this filter.</div>}
        </div>
      </div>
    </div>
  );
}

export const selStyle = {
  background: "var(--panel-raised)", border: "1px solid var(--line)", color: "var(--text)",
  fontSize: 12, padding: "8px 10px", borderRadius: 3, outline: "none",
};

/* ============================== RISK INTELLIGENCE ============================== */

function RiskIntelligence() {
  const {
    pendingRiskZoneId,
    setPendingRiskZoneId,
    navigate,
    createAlertForZone,
    riskResult
  } = useApp();
  const zone = ZONE_BY_ID[pendingRiskZoneId] || ZONES[3];
  const [analyzing, setAnalyzing] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [alertCreated, setAlertCreated] = useState(null);
  const timers = useRef([]);

  useEffect(() => { setShowResult(false); setAlertCreated(null); }, [pendingRiskZoneId]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function run() {
    setAnalyzing(true);
    setShowResult(false);
    const t = setTimeout(() => { setAnalyzing(false); setShowResult(true); }, 1100);
    timers.current.push(t);
  }

  function createAlert() {
    const a = createAlertForZone(zone.id);
    setAlertCreated(a);
  }

  const featureLabels = [
    ["Wildlife Activity", "wildlifeActivity"],
    ["Historical Conflict", "historicalConflict"],
    ["Settlement Proximity", "settlementProximity"],
    ["Temporal Pattern", "temporalPattern"],
    ["Environmental Context", "environmentalContext"],
    ["Spatial Relationship", "spatialRelationship"],
  ];

  return (
    <div className="kv-fadein" style={{ maxWidth: 880 }}>
      <div className="kv-panel" style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div className="kv-display" style={{ fontSize: 16, fontWeight: 700 }}>INPUT FEATURES</div>
          <select value={pendingRiskZoneId} onChange={e => setPendingRiskZoneId(e.target.value)} style={selStyle}>
            {ZONES.map(z => <option key={z.id} value={z.id}>{z.id} · {z.name} ({z.species})</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {featureLabels.map(([label, key]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: "var(--panel-raised)", border: "1px solid var(--line-soft)", borderRadius: 3 }}>
              <span style={{ fontSize: 13 }}>{label}</span>
              <FeatureLevelPill level={zone.factors[key]} />
            </div>
          ))}
        </div>
        <button className="kv-btn kv-btn-primary" style={{ marginTop: 18, width: "100%", justifyContent: "center" }} disabled={analyzing} onClick={run}>
          {analyzing ? <><RefreshCw size={14} style={{ animation: "kv-spin 1s linear infinite" }} /> RUNNING RISK MODEL…</> : <><Crosshair size={14} /> RUN RISK ANALYSIS</>}
        </button>
      </div>

      {showResult && (
        <div className="kv-panel kv-fadein" style={{ padding: 24, borderColor: "var(--amber-dim)" }}>
          <div className="kv-tag" style={{ marginBottom: 12 }}>ML RISK MODEL · ZONE {zone.id}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>

            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <div
                className="kv-display"
                style={{
                  fontSize: 52,
                  fontWeight: 700,
                  color: riskVar(riskResult?.level || zone.riskLevel),
                  lineHeight: 1
                }}
              >
                {riskResult
                  ? `${riskResult.score.toFixed(2)}%`
                  : `${riskResult
                    ? `${riskResult.score.toFixed(2)}%`
                    : `${zone.risk}%`}`}
              </div>

              <RiskBadge
                level={riskResult?.level || zone.riskLevel}
              />
            </div>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>CONFLICT RISK SCORE — {zone.name}, {zone.species}</div>

          <div style={{ marginTop: 20 }}>
            <div className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10, letterSpacing: "0.06em" }}>TOP CONTRIBUTING FACTORS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {zone.topFactors.map((f, i) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--panel-raised)", borderRadius: 3, border: "1px solid var(--line-soft)" }}>
                  <span className="kv-mono" style={{ color: "var(--amber)", fontSize: 12 }}>{i + 1}</span>
                  <span style={{ fontSize: 13 }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 20, padding: 14, background: "rgba(232,163,61,0.06)", border: "1px solid var(--amber-dim)", borderRadius: 3 }}>
            <div className="kv-mono" style={{ fontSize: 10.5, color: "var(--amber)", marginBottom: 4 }}>RECOMMENDED</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{getRecommendation(
  riskResult ? riskResult.score : zone.risk
)}</div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
            <button className="kv-btn" onClick={() => navigate("gis", { zoneId: zone.id, gisRiskFilter: "all", gisSpeciesFilter: "all" })}>
              <MapIcon size={13} /> VIEW ON GIS
            </button>
            {!alertCreated ? (
              <button className="kv-btn kv-btn-primary" onClick={createAlert}>
                <Bell size={13} /> CREATE ALERT
              </button>
            ) : (
              <button className="kv-btn" style={{ borderColor: "var(--low)", color: "var(--low)" }} onClick={() => navigate("alerts", { alertStatusFilter: "all", alertPriorityFilter: "all", highlightAlertId: alertCreated.id })}>
                <CheckCircle2 size={13} /> {alertCreated.id} CREATED — VIEW IN ALERTS
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== GIS MAP ============================== */
/* Real PostGIS + FastAPI + React-Leaflet GIS map. See src/gis/RealGISMap.jsx
   and backend/gis/ — this thin wrapper keeps the rest of this file (and the
   page-switching/navigation logic below) completely unchanged. */

function GISMap() {
  return <RealGISMap />;
}

// Small decorative marker kept for the Intelligence Pipeline walkthrough
// preview only (unrelated to the real GIS map above) — pixel-identical to
// the original so that page's UI is untouched.
function ZoneMarker({ zone, muted, onClick }) {
  const color = riskVar(zone.riskLevel);
  return (
    <div onClick={onClick} style={{
      position: "absolute", left: `${zone.x}%`, top: `${zone.y}%`, transform: "translate(-50%,-50%)",
      cursor: "pointer", opacity: muted ? 0.18 : 1, transition: "opacity .2s ease", zIndex: muted ? 1 : 2,
    }}>
      <div style={{ position: "relative", width: 18, height: 18 }}>
        {zone.riskLevel === "HIGH" && !muted && (
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `2px solid ${color}`, animation: "kv-pulse 1.8s ease-out infinite" }} />
        )}
        <div style={{ width: 18, height: 18, borderRadius: "50%", background: color, border: "2px solid #0A100C", boxShadow: `0 0 10px ${color}88` }} />
      </div>
      <div className="kv-mono" style={{ position: "absolute", top: 22, left: "50%", transform: "translateX(-50%)", fontSize: 9.5, color: "var(--text-muted)", whiteSpace: "nowrap", background: "rgba(10,16,12,0.75)", padding: "1px 5px", borderRadius: 2 }}>
        {zone.id}
      </div>
    </div>
  );
}
/* ============================== ALERTS ============================== */

function AlertCard({ alert, highlighted }) {
  const { navigate, acknowledgeAlert } = useApp();
  return (
    <div className="kv-panel kv-fadein" style={{ padding: 18, borderColor: highlighted ? "var(--amber)" : "var(--line)", background: highlighted ? "rgba(232,163,61,0.05)" : "var(--panel)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RiskBadge level={alert.priority} />
          <span className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{alert.id}</span>
        </div>
        <span className="kv-tag" style={{ color: alert.status === "PENDING" ? "var(--amber)" : "var(--low)", borderColor: alert.status === "PENDING" ? "var(--amber-dim)" : "#2c4a35" }}>
          {alert.status}
        </span>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 10 }}>
        <div className="kv-display" style={{ fontSize: 18, fontWeight: 700 }}>{alert.zone} · {ZONE_BY_ID[alert.zone].name}</div>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{alert.species} — <span className="kv-mono" style={{ color: riskVar(alert.priority) }}>{alert.risk}% risk</span></div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.6 }}>{alert.reason}</div>
      <div style={{ marginTop: 10, padding: "8px 11px", background: "var(--panel-raised)", borderRadius: 3, border: "1px solid var(--line-soft)" }}>
        <span className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)" }}>RECOMMENDED · </span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{alert.recommended}</span>
      </div>
      <div className="kv-mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 10 }}>{alert.timestamp}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className="kv-btn" style={{ fontSize: 11 }} onClick={() => navigate("gis", { zoneId: alert.zone, gisRiskFilter: "all", gisSpeciesFilter: "all" })}>
          <MapIcon size={12} /> VIEW ON MAP
        </button>
        <button className="kv-btn" style={{ fontSize: 11 }} onClick={() => navigate("risk", { riskZoneId: alert.zone })}>
          <ShieldAlert size={12} /> VIEW ANALYSIS
        </button>
        {alert.status === "PENDING" && (
          <button className="kv-btn kv-btn-primary" style={{ fontSize: 11 }} onClick={() => acknowledgeAlert(alert.id)}>
            <Check size={12} /> ACKNOWLEDGE
          </button>
        )}
      </div>
    </div>
  );
}

function AlertHistoryItem({ alert, highlighted }) {
  const { acknowledgeAlert, navigate } = useApp();
  const riskLabel = alert.priority?.toUpperCase() || "LOW";
  return (
    <div className="kv-panel kv-fadein" style={{ padding: 18, borderColor: highlighted ? "var(--amber)" : "var(--line)", background: highlighted ? "rgba(232,163,61,0.05)" : "var(--panel)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{alert.id}</span>
          <span className="kv-mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{alert.timestamp}</span>
        </div>
        <span className="kv-tag" style={{ color: alert.status === "PENDING" ? "var(--amber)" : "var(--low)", borderColor: alert.status === "PENDING" ? "var(--amber-dim)" : "#2c4a35" }}>
          {alert.status}
        </span>
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div className="kv-mono" style={{ fontSize: 12, letterSpacing: "0.08em", color: riskVar(riskLabel), textTransform: "uppercase" }}>{riskLabel} RISK</div>
        <div className="kv-display" style={{ fontSize: 18, fontWeight: 700 }}>{alert.species} — Zone {alert.zone}</div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div style={{ padding: "9px 10px", border: "1px solid var(--line-soft)", borderRadius: 3, background: "var(--panel-raised)" }}>
          <div className="kv-mono" style={{ fontSize: 9.5, color: "var(--text-dim)" }}>RISK SCORE</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{alert.risk}%</div>
        </div>
        <div style={{ padding: "9px 10px", border: "1px solid var(--line-soft)", borderRadius: 3, background: "var(--panel-raised)" }}>
          <div className="kv-mono" style={{ fontSize: 9.5, color: "var(--text-dim)" }}>ZONE</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{alert.zone} · {ZONE_BY_ID[alert.zone]?.name || "Unknown Zone"}</div>
        </div>
      </div>

      <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--panel-raised)", borderRadius: 3, border: "1px solid var(--line-soft)" }}>
        <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)" }}>REASON</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 4 }}>{alert.reason}</div>
      </div>

      <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--panel-raised)", borderRadius: 3, border: "1px solid var(--line-soft)" }}>
        <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)" }}>RECOMMENDED ACTION</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{alert.recommended}</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button className="kv-btn" style={{ fontSize: 11 }} onClick={() => navigate("gis", { zoneId: alert.zone, gisRiskFilter: "all", gisSpeciesFilter: "all" })}>
          <MapIcon size={12} /> VIEW ON MAP
        </button>
        <button className="kv-btn" style={{ fontSize: 11 }} onClick={() => navigate("risk", { riskZoneId: alert.zone })}>
          <ShieldAlert size={12} /> VIEW ANALYSIS
        </button>
        {alert.status === "PENDING" && (
          <button className="kv-btn kv-btn-primary" style={{ fontSize: 11 }} onClick={() => acknowledgeAlert(alert.id)} aria-label={`Acknowledge alert ${alert.id}`}>
            <Check size={12} /> ACKNOWLEDGE
          </button>
        )}
      </div>
    </div>
  );
}

function AlertsPage() {
  const { alerts, alertPriorityFilter, setAlertPriorityFilter, alertStatusFilter, setAlertStatusFilter, highlightAlertId } = useApp();
  const [activeTab, setActiveTab] = useState("active");

  const filtered = alerts.filter(a =>
    (alertPriorityFilter === "all" || a.priority.toLowerCase() === alertPriorityFilter) &&
    (alertStatusFilter === "all" || a.status.toLowerCase() === alertStatusFilter)
  );

  const summary = useMemo(() => {
    const total = alerts.length;
    const high = alerts.filter(a => a.priority === "HIGH").length;
    const medium = alerts.filter(a => a.priority === "MEDIUM").length;
    const low = alerts.filter(a => a.priority === "LOW").length;
    const pending = alerts.filter(a => a.status === "PENDING").length;
    const acknowledged = alerts.filter(a => a.status === "ACKNOWLEDGED").length;
    return { total, high, medium, low, pending, acknowledged };
  }, [alerts]);

  const tabStyle = (tab) => ({
    padding: "8px 12px",
    borderRadius: 4,
    border: "1px solid var(--line)",
    background: activeTab === tab ? "var(--panel-raised)" : "transparent",
    color: activeTab === tab ? "var(--text)" : "var(--text-muted)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
  });

  return (
    <div className="kv-fadein" style={{ maxWidth: 880 }}>
      <div role="tablist" aria-label="Alert views" style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <button type="button" role="tab" aria-selected={activeTab === "active"} onClick={() => setActiveTab("active")} style={tabStyle("active")}>[ Active Alerts ]</button>
        <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setActiveTab("history")} style={tabStyle("history")}>[ Alert History ]</button>
      </div>

      {activeTab === "history" && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 18 }}>
            {[
              { label: "Total Alerts", value: summary.total },
              { label: "High Risk", value: summary.high },
              { label: "Medium Risk", value: summary.medium },
              { label: "Low Risk", value: summary.low },
              { label: "Pending", value: summary.pending },
              { label: "Acknowledged", value: summary.acknowledged },
            ].map(item => (
              <div key={item.label} className="kv-panel" style={{ padding: "12px 14px", background: "var(--panel-raised)" }}>
                <div className="kv-mono" style={{ fontSize: 9.5, color: "var(--text-dim)", letterSpacing: "0.06em" }}>{item.label.toUpperCase()}</div>
                <div className="kv-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <select value={alertPriorityFilter} onChange={e => setAlertPriorityFilter(e.target.value)} style={selStyle} aria-label="Filter alerts by risk level">
          <option value="all">Priority: All</option>
          <option value="high">Priority: High</option>
          <option value="medium">Priority: Medium</option>
          <option value="low">Priority: Low</option>
        </select>
        <select value={alertStatusFilter} onChange={e => setAlertStatusFilter(e.target.value)} style={selStyle} aria-label="Filter alerts by status">
          <option value="all">Status: All</option>
          <option value="pending">Status: Pending</option>
          <option value="acknowledged">Status: Acknowledged</option>
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {activeTab === "active" ? (
          filtered.length === 0 ? <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No alerts match this filter.</div> : filtered.map(a => <AlertCard key={a.id} alert={a} highlighted={highlightAlertId === a.id} />)
        ) : (
          <>
            {[...alerts].sort((a, b) => b.id.localeCompare(a.id)).filter(a =>
              (alertPriorityFilter === "all" || a.priority.toLowerCase() === alertPriorityFilter) &&
              (alertStatusFilter === "all" || a.status.toLowerCase() === alertStatusFilter)
            ).length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No alert history match this filter.</div>
            ) : (
              [...alerts].sort((a, b) => b.id.localeCompare(a.id)).filter(a =>
                (alertPriorityFilter === "all" || a.priority.toLowerCase() === alertPriorityFilter) &&
                (alertStatusFilter === "all" || a.status.toLowerCase() === alertStatusFilter)
              ).map(a => <AlertHistoryItem key={a.id} alert={a} highlighted={highlightAlertId === a.id} />)
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================== PIPELINE ============================== */

function PipelinePage() {
  const { navigate } = useApp();
  const stages = [
    { id: "CAMERA TRAP", icon: Camera, desc: "Field devices capture motion-triggered imagery across monitored corridors.", go: () => navigate("wildlife", {}) },
    { id: "AI DETECTION", icon: ScanLine, desc: "Species classification runs against each capture with a confidence score.", go: () => navigate("wildlife", {}) },
    { id: "CONTEXT INTEGRATION", icon: Layers, desc: "Detection is merged with historical conflict and settlement-proximity data.", go: () => navigate("risk", { riskZoneId: "Z-04" }) },
    { id: "RISK PREDICTION", icon: ShieldAlert, desc: "The risk model scores the encounter likelihood for the zone.", go: () => navigate("risk", { riskZoneId: "Z-04" }) },
    { id: "GIS HOTSPOT", icon: MapIcon, desc: "High-risk corridors are surfaced on the live map for spatial context.", go: () => navigate("gis", { zoneId: "Z-04", gisRiskFilter: "all", gisSpeciesFilter: "all" }) },
    { id: "EARLY ACTION", icon: Bell, desc: "An alert is raised so field teams can prioritize monitoring or patrol.", go: () => navigate("alerts", { alertStatusFilter: "all", alertPriorityFilter: "all" }) },
  ];
  return (
    <div className="kv-fadein" style={{ maxWidth: 620 }}>
      <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 22, lineHeight: 1.6 }}>
        The chain from field observation to field action. Click any stage to open its working view.
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {stages.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.id} style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--panel-raised)", border: "1px solid var(--amber-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={17} color="var(--amber)" />
                </div>
                {i < stages.length - 1 && <div style={{ width: 1, flex: 1, background: "var(--line)", minHeight: 34 }} />}
              </div>
              <button onClick={s.go} className="kv-panel" style={{ flex: 1, marginBottom: 18, padding: "14px 16px", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--amber-dim)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--line)"}
              >
                <div>
                  <div className="kv-display" style={{ fontSize: 15, fontWeight: 700 }}>{i + 1}. {s.id}</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>{s.desc}</div>
                </div>
                <ChevronRight size={16} color="var(--text-dim)" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== DEMO MODAL ============================== */

const DEMO_STEPS = [
  "Selecting camera-trap image",
  "Running AI detection",
  "Integrating context features",
  "Running risk prediction engine",
  "Computing conflict risk score",
  "Highlighting GIS hotspot",
  "Creating early-warning alert",
  "Updating Command Center",
];

function DemoModal() {
  const { setDemoOpen, addDetection, createAlertForZone, navigate } = useApp();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const committed = useRef(false);
  const timers = useRef([]);

  const zone = ZONE_BY_ID["Z-04"];

  useEffect(() => {
    DEMO_STEPS.forEach((_, i) => {
      const t = setTimeout(() => {
        setStep(i);
        if (i === 6 && !committed.current) {
          committed.current = true;
          const det = { id: nextId("D"), species: "Asian Elephant", confidence: 94, zone: "Z-04", timestamp: "Just now" };
          addDetection(det);
          createAlertForZone("Z-04");
        }
        if (i === DEMO_STEPS.length - 1) {
          const t2 = setTimeout(() => setDone(true), 900);
          timers.current.push(t2);
        }
      }, i * 900);
      timers.current.push(t);
    });
    return () => timers.current.forEach(clearTimeout);
  }, []);

  function finish() {
    setDemoOpen(false);
    navigate("command", {});
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(6,10,7,0.78)", backdropFilter: "blur(3px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="kv-panel kv-fadein" style={{ width: "min(720px, 100%)", maxHeight: "88vh", overflowY: "auto", padding: 26, position: "relative" }}>
        <button onClick={() => setDemoOpen(false)} style={{ position: "absolute", top: 18, right: 18, background: "transparent", border: "none", color: "var(--text-dim)" }}><X size={18} /></button>
        <div className="kv-tag" style={{ marginBottom: 10 }}><Play size={11} /> KAVACH END-TO-END DEMO</div>
        <div className="kv-display" style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Observation → Intelligence → Prediction → Location → Action</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 20 }}>
          {DEMO_STEPS.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", opacity: i <= step ? 1 : 0.32 }}>
              {i < step ? <CheckCircle2 size={15} color="var(--low)" /> : i === step ? <RefreshCw size={15} color="var(--amber)" style={{ animation: "kv-spin 1s linear infinite" }} /> : <div style={{ width: 15, height: 15, borderRadius: "50%", border: "1px solid var(--line)" }} />}
              <span className="kv-mono" style={{ fontSize: 12 }}>{s.toUpperCase()}</span>
            </div>
          ))}
        </div>

        {step >= 1 && (
          <div className="kv-panel kv-fadein" style={{ padding: 16, marginBottom: 12, background: "var(--panel-raised)" }}>
            <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6 }}>DETECTION</div>
            <div className="kv-display" style={{ fontSize: 20, fontWeight: 700 }}>ASIAN ELEPHANT</div>
            <div className="kv-mono" style={{ color: "var(--amber)", fontSize: 13 }}>94% CONFIDENCE · ZONE Z-04</div>
          </div>
        )}

        {step >= 2 && (
          <div className="kv-panel kv-fadein" style={{ padding: 16, marginBottom: 12, background: "var(--panel-raised)" }}>
            <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8 }}>CONTEXT FEATURES</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["Wildlife Activity", "HIGH"], ["Historical Conflict", "HIGH"], ["Settlement Proximity", "HIGH"], ["Temporal Pattern", "MEDIUM"], ["Environment", "MEDIUM"]].map(([l, v]) => (
                <span key={l} className="kv-mono" style={{ fontSize: 10.5, padding: "5px 9px", borderRadius: 2, border: `1px solid ${riskVar(v)}55`, color: riskVar(v) }}>{l}: {v}</span>
              ))}
            </div>
          </div>
        )}

        {step >= 4 && (
          <div className="kv-panel kv-fadein" style={{ padding: 16, marginBottom: 12, background: "var(--panel-raised)" }}>
            <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6 }}>RISK RESULT</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div className="kv-display" style={{ fontSize: 32, fontWeight: 700, color: "var(--high)" }}>89%</div>
              <RiskBadge level="HIGH" />
            </div>
          </div>
        )}

        {step >= 5 && (
          <div className="kv-panel kv-fadein" style={{ padding: 16, marginBottom: 12, background: "var(--panel-raised)" }}>
            <div className="kv-mono" style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8 }}>GIS HOTSPOT</div>
            <div style={{ position: "relative", height: 90, borderRadius: 3, background: "radial-gradient(circle at 50% 50%, #16241a, #0a100c)", overflow: "hidden" }}>
              <ZoneMarker zone={zone} muted={false} onClick={() => {}} />
            </div>
          </div>
        )}

        {step >= 6 && (
          <div className="kv-panel kv-fadein" style={{ padding: 16, marginBottom: 4, borderColor: "var(--amber-dim)" }}>
            <div className="kv-mono" style={{ fontSize: 10, color: "var(--amber)", marginBottom: 6 }}>ALERT CREATED</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>HIGH PRIORITY · ZONE Z-04 · {getRecommendation(zone.risk)}</div>
          </div>
        )}

        {done && (
          <button className="kv-btn kv-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 18 }} onClick={finish}>
            RETURN TO COMMAND CENTER <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================== ROOT ============================== */

export default function KavachApp() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}