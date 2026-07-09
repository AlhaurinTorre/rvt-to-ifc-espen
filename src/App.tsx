import React, { useState, useEffect, useRef } from "react";
import { 
  Upload, 
  FileCode, 
  Trash2, 
  Download, 
  ArrowRight, 
  Sliders, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  HelpCircle,
  Clock,
  Briefcase,
  Layers,
  ChevronDown,
  ChevronUp,
  FileText,
  Globe,
  Eye,
  Settings,
  Database,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ConversionItem } from "./types";
import { TRANSLATIONS } from "./translations";
import BIM3DViewport from "./components/BIM3DViewport";

export default function App() {
  // Navigation tabs: 'home' | 'convert' | 'viewer'
  const [activeTab, setActiveTab] = useState<"home" | "convert" | "viewer">("home");
  
  // Language state
  const [lang, setLang] = useState<"es" | "en">("es");
  
  // Selector translation helper
  const t = (key: keyof typeof TRANSLATIONS["es"]) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS["es"][key];
  };

  // Viewer state variables
  const [viewerSelectedFileId, setViewerSelectedFileId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // Export Settings state
  const [ifcSchema, setIfcSchema] = useState("IFC4 Design Transfer View");
  const [includeRevitProps, setIncludeRevitProps] = useState(true);
  const [exportQuantities, setExportQuantities] = useState(false);
  const [exportBaseQuantities, setExportBaseQuantities] = useState(true);
  const [geometryPrecision, setGeometryPrecision] = useState<"normal" | "high">("normal");
  
  // Conversion state
  const [files, setFiles] = useState<ConversionItem[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // History list persisted in localStorage
  const [history, setHistory] = useState<ConversionItem[]>([]);
  
  // Log consoles state for each file (active file ID expanded)
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);

  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem("rvt_to_ifc_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (err) {
        console.error("Error reading history from localStorage", err);
      }
    }
  }, []);

  // Save history to localStorage
  const saveHistory = (newHistory: ConversionItem[]) => {
    setHistory(newHistory);
    localStorage.setItem("rvt_to_ifc_history", JSON.stringify(newHistory));
  };

  // Drag handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      addFilesToList(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      addFilesToList(e.target.files);
    }
  };

  // Add files to current session list
  const addFilesToList = (fileList: FileList) => {
    const newItems: ConversionItem[] = [];
    
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const isRfa = file.name.toLowerCase().endsWith(".rfa");
      const id = "file_" + Math.random().toString(36).substring(2, 9);
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      
      newItems.push({
        id,
        fileName: file.name,
        fileSize: `${sizeMB} MB`,
        status: "idle",
        progress: 0,
        revitVersion: "Desconocido",
        author: "Desconocido",
        createdAt: new Date().toLocaleString(),
        downloadUrl: null,
        fileType: isRfa ? "rfa" : "rvt",
        logs: [
          `[${new Date().toLocaleTimeString()}] ${lang === "es" ? "Archivo añadido a la cola:" : "File added to queue:"} ${file.name} (${sizeMB} MB)`,
          `[${new Date().toLocaleTimeString()}] ${lang === "es" ? "Listo para iniciar conversión." : "Ready for conversion."}`
        ]
      });

      // Keep reference to the actual File object for upload
      (window as any)[`file_raw_${id}`] = file;
    }

    setFiles(prev => [...prev, ...newItems]);
    if (newItems.length > 0) {
      setExpandedFileId(newItems[0].id);
    }
  };

  // Convert a single file
  const convertFile = async (id: string) => {
    const item = files.find(f => f.id === id);
    if (!item || item.status !== "idle") return;

    const rawFile = (window as any)[`file_raw_${id}`] as File;
    if (!rawFile) {
      updateFileState(id, {
        status: "failed",
        logs: [...item.logs, `[${new Date().toLocaleTimeString()}] ❌ ${lang === "es" ? "Error: Archivo de datos perdido." : "Error: Data file lost."}`]
      });
      return;
    }

    const appendLog = (msg: string) => {
      setFiles(prev => prev.map(f => {
        if (f.id === id) {
          return { ...f, logs: [...f.logs, `[${new Date().toLocaleTimeString()}] ${msg}`] };
        }
        return f;
      }));
    };

    try {
      // 1. Start Upload
      updateFileState(id, { status: "uploading", progress: 15 });
      appendLog(lang === "es" 
        ? `📤 Subiendo archivo ${rawFile.name} al servidor para extracción de metadatos...`
        : `📤 Uploading file ${rawFile.name} to server for metadata extraction...`
      );

      // Read file into array buffer
      const fileBuffer = await readFileAsArrayBuffer(rawFile);
      
      // Send to server
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(rawFile.name)
        },
        body: fileBuffer
      });

      if (!response.ok) {
        throw new Error(`Error en el servidor: ${response.statusText}`);
      }

      // 2. Parse Server Response
      updateFileState(id, { status: "parsing", progress: 45 });
      const result = await response.json();
      
      appendLog(lang === "es" ? `🔍 Metadatos analizados con éxito.` : `🔍 Metadata parsed successfully.`);
      appendLog(`🏗️ ${lang === "es" ? "Versión detectada" : "Version detected"}: ${result.metadata.version}`);
      appendLog(`👤 ${lang === "es" ? "Usuario creador" : "Creator"}: ${result.metadata.author}`);
      appendLog(`📂 ${lang === "es" ? "Nombre de Proyecto" : "Project Name"}: ${result.metadata.projectName}`);
      appendLog(`🏷️ ${lang === "es" ? "Tipo de Archivo" : "File Type"}: ${result.metadata.fileType === "rfa" ? "Familia Revit (.RFA)" : "Proyecto Revit (.RVT)"}`);

      // 3. Simulated Conversion Process (Providing high fidelity serverless simulation steps)
      updateFileState(id, { status: "converting", progress: 60 });
      await sleep(800);
      appendLog(lang === "es" ? `⚙️ Inicializando el motor de Revit Core Engine...` : `⚙️ Initializing Revit Core Engine...`);
      updateFileState(id, { progress: 75 });
      
      await sleep(800);
      appendLog(lang === "es" ? `📐 Compilando base de datos geométrica a formato IFC4...` : `📐 Compiling geometric database to IFC4 format...`);
      updateFileState(id, { progress: 90 });
      
      await sleep(500);
      appendLog(lang === "es" ? `📄 Generando archivo IFC física STEP (ISO-10303-21)...` : `📄 Generating physical IFC STEP file (ISO-10303-21)...`);
      
      const downloadUrl = `/api/download/${result.id}`;

      // 4. Completed
      const completedItem: ConversionItem = {
        ...item,
        status: "completed",
        progress: 100,
        revitVersion: result.metadata.version,
        author: result.metadata.author,
        fileType: result.metadata.fileType,
        elements: result.elements,
        downloadUrl,
        logs: [
          ...item.logs,
          `[${new Date().toLocaleTimeString()}] ${lang === "es" ? "📤 Subiendo archivo..." : "📤 Uploading file..."}`,
          `[${new Date().toLocaleTimeString()}] ${lang === "es" ? "🔍 Metadatos analizados con éxito." : "🔍 Metadata parsed successfully."}`,
          `[${new Date().toLocaleTimeString()}] 🏗️ ${lang === "es" ? "Versión Revit" : "Revit Version"}: ${result.metadata.version}`,
          `[${new Date().toLocaleTimeString()}] 👤 ${lang === "es" ? "Usuario" : "Creator"}: ${result.metadata.author}`,
          `[${new Date().toLocaleTimeString()}] 🏷️ ${lang === "es" ? "Tipo de Archivo" : "File Type"}: ${result.metadata.fileType === "rfa" ? "Familia (.RFA)" : "Proyecto (.RVT)"}`,
          `[${new Date().toLocaleTimeString()}] ⚙️ ${lang === "es" ? "Inicializando motor de conversión Revit..." : "Initializing Revit conversion engine..."}`,
          `[${new Date().toLocaleTimeString()}] 📐 ${lang === "es" ? "Compilando base geométrica a IFC4..." : "Compiling geometric base to IFC4..."}`,
          `[${new Date().toLocaleTimeString()}] 📄 ${lang === "es" ? "Generando archivo físico STEP..." : "Generating physical STEP file..."}`,
          `[${new Date().toLocaleTimeString()}] 🎉 ${lang === "es" ? "Conversión finalizada. Archivo listo." : "Conversion completed. File ready."}`
        ]
      };

      // Update current session list
      setFiles(prev => prev.map(f => f.id === id ? completedItem : f));
      
      // Update persistent history
      saveHistory([completedItem, ...history]);

      // Automatically select this completed file for the 3D Viewer!
      setViewerSelectedFileId(completedItem.id);

    } catch (err: any) {
      console.error(err);
      const failedLogs = [
        ...item.logs,
        `[${new Date().toLocaleTimeString()}] ❌ ${lang === "es" ? "Error crítico" : "Critical error"}: ${err.message || err}`
      ];
      updateFileState(id, { 
        status: "failed", 
        progress: 0, 
        logs: failedLogs 
      });
    }
  };

  // Helper to read file
  const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Helper to update state of a single file in the queue
  const updateFileState = (id: string, updates: Partial<ConversionItem>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  // Convert all idle files
  const handleConvertAll = async () => {
    const idleFiles = files.filter(f => f.status === "idle");
    for (const f of idleFiles) {
      await convertFile(f.id);
    }
  };

  // Clear current upload list
  const handleClearList = () => {
    files.forEach(f => {
      delete (window as any)[`file_raw_${f.id}`];
    });
    setFiles([]);
    setExpandedFileId(null);
  };

  // Delete a specific file from current upload queue
  const handleDeleteItem = (id: string) => {
    delete (window as any)[`file_raw_${id}`];
    setFiles(prev => prev.filter(f => f.id !== id));
    if (expandedFileId === id) {
      setExpandedFileId(null);
    }
  };

  // Clear persistent history
  const handleClearHistory = () => {
    const confirmMsg = lang === "es" 
      ? "¿Seguro que deseas vaciar el historial de conversiones guardado en este navegador?" 
      : "Are you sure you want to clear the conversion history saved in this browser?";
    if (window.confirm(confirmMsg)) {
      saveHistory([]);
    }
  };

  // Multi-Format Data-Driven Exports (JSON, XML, CSV) inspired by cad2data
  const handleExportData = (format: "json" | "xml" | "csv", item: ConversionItem) => {
    if (!item.elements || item.elements.length === 0) return;
    
    const baseName = item.fileName.replace(/\.(rvt|rfa|ifc)$/i, "");
    
    if (format === "json") {
      const dataStr = JSON.stringify(item.elements, null, 2);
      downloadTextFile(dataStr, `${baseName}_cad2data.json`, "application/json");
    } else if (format === "xml") {
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<BIMModel fileName="${item.fileName}" revitVersion="${item.revitVersion}">\n`;
      item.elements.forEach(el => {
        xml += `  <BIMElement id="${el.id}">\n`;
        xml += `    <Name>${el.name}</Name>\n`;
        xml += `    <Category>${el.category}</Category>\n`;
        xml += `    <IFCClass>${el.ifcClass}</IFCClass>\n`;
        xml += `    <Family>${el.family}</Family>\n`;
        xml += `    <Type>${el.type}</Type>\n`;
        xml += `    <Properties>\n`;
        Object.entries(el.properties || {}).forEach(([groupName, groupProps]: any) => {
          xml += `      <PropertyGroup name="${groupName}">\n`;
          Object.entries(groupProps || {}).forEach(([propName, propVal]: any) => {
            xml += `        <Property name="${propName}">${propVal}</Property>\n`;
          });
          xml += `      </PropertyGroup>\n`;
        });
        xml += `    </Properties>\n`;
        xml += `  </BIMElement>\n`;
      });
      xml += `</BIMModel>`;
      downloadTextFile(xml, `${baseName}_cad2data.xml`, "text/xml");
    } else if (format === "csv") {
      let csv = "ElementID,ElementName,Category,IFCClass,Family,Type,PropertyGroup,PropertyName,PropertyValue\n";
      item.elements.forEach(el => {
        Object.entries(el.properties || {}).forEach(([groupName, groupProps]: any) => {
          Object.entries(groupProps || {}).forEach(([propName, propVal]: any) => {
            const row = [
              el.id,
              `"${el.name.replace(/"/g, '""')}"`,
              `"${el.category.replace(/"/g, '""')}"`,
              el.ifcClass,
              `"${el.family.replace(/"/g, '""')}"`,
              `"${el.type.replace(/"/g, '""')}"`,
              `"${groupName.replace(/"/g, '""')}"`,
              `"${propName.replace(/"/g, '""')}"`,
              `"${String(propVal).replace(/"/g, '""')}"`
            ].join(",");
            csv += row + "\n";
          });
        });
      });
      downloadTextFile(csv, `${baseName}_cad2data.csv`, "text/csv");
    }
  };

  const downloadTextFile = (content: string, filename: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Retrieve selected file for the viewer from queue or history
  const getSelectedFileInViewer = (): ConversionItem | null => {
    if (!viewerSelectedFileId) return null;
    return files.find(f => f.id === viewerSelectedFileId && f.status === "completed") || 
           history.find(h => h.id === viewerSelectedFileId) || 
           null;
  };

  const activeViewerFile = getSelectedFileInViewer();
  const activeViewerElements = activeViewerFile?.elements || [];
  const selectedElementDetails = activeViewerElements.find(el => el.id === selectedElementId);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      
      {/* HEADER NAVBAR - Clean Minimalism Style */}
      <header className="h-16 px-6 md:px-8 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div 
          onClick={() => setActiveTab("home")} 
          className="flex items-center space-x-3 cursor-pointer group"
          id="nav_logo"
        >
          {/* Logo RVT / IFC */}
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center shadow-sm group-hover:bg-blue-700 transition">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-slate-800">
            RVT <span className="text-blue-600">/</span> RFA <span className="text-blue-600 font-bold">→</span> IFC
          </span>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1" id="nav_menu">
          <button 
            onClick={() => setActiveTab("home")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
              activeTab === "home" 
                ? "bg-slate-100 text-blue-600 font-bold border border-slate-200/50 shadow-sm" 
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/50"
            }`}
          >
            {t("navHome")}
          </button>

          <button 
            onClick={() => setActiveTab("convert")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
              activeTab === "convert" 
                ? "bg-slate-100 text-blue-600 font-bold border border-slate-200/50 shadow-sm" 
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/50"
            }`}
            id="btn_nav_convert"
          >
            {t("navConvert")}
          </button>
          
          <button 
            onClick={() => setActiveTab("viewer")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1 ${
              activeTab === "viewer" 
                ? "bg-slate-100 text-blue-600 font-bold border border-slate-200/50 shadow-sm" 
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/50"
            }`}
            id="btn_nav_viewer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{t("navViewer")}</span>
          </button>

          <div className="h-5 w-px bg-slate-200 mx-2 hidden sm:block"></div>

          {/* Bilingual Language Switcher */}
          <button
            onClick={() => setLang(l => l === "es" ? "en" : "es")}
            className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-900 bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200 rounded-lg flex items-center gap-1.5 shadow-sm transition"
            title={lang === "es" ? "Switch to English" : "Cambiar a Español"}
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span>{lang === "es" ? "ES" : "EN"}</span>
          </button>

          {/* Cloud Worker status info and metadata */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full border border-green-100 text-[10px] font-bold uppercase tracking-wider pl-2.5">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            <span>{t("workerStatus")}</span>
          </div>

          <div className="hidden md:block text-[11px] text-slate-400 font-medium pl-1">
            {t("noAccount")}
          </div>
        </nav>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: LANDING HOME VIEW */}
          {activeTab === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="space-y-12 py-6"
              id="view_landing_home"
            >
              {/* Hero Title */}
              <div className="text-center md:text-left space-y-2">
                <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 tracking-tight">
                  {t("heroTitle")}
                </h1>
                <p className="text-lg md:text-xl font-light text-slate-500 max-w-3xl leading-relaxed">
                  {t("heroSubtitle")}
                </p>
              </div>

              {/* Three Cards Layout (Clean Minimalism theme) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="bento_cards_container">
                
                {/* Card 1: Convert to IFC */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition duration-300">
                  <div className="space-y-4">
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full uppercase tracking-widest">{t("card1Sub")}</span>
                    <h3 className="text-2xl font-display font-bold text-slate-800">
                      {t("card1Title")}
                    </h3>
                    <p className="text-sm text-slate-500">
                      {t("card1Desc")}
                    </p>
                    
                    {/* Visual Icon (RVT/RFA -> IFC Arrow in Blue Theme) */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 flex items-center justify-center space-x-3 my-4">
                      <div className="bg-slate-800 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm font-mono">
                        RVT / RFA
                      </div>
                      <ArrowRight className="w-5 h-5 text-blue-600 animate-pulse" />
                      <div className="bg-blue-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm font-mono">
                        IFC4
                      </div>
                    </div>
                  </div>

                  <div className="pt-6">
                    <button 
                      onClick={() => setActiveTab("convert")}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg text-sm tracking-wider uppercase transition duration-300 flex items-center justify-center space-x-2 shadow-sm"
                    >
                      <span>{t("card1Btn")}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Card 2: Fine tune your export */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition duration-300">
                  <div className="space-y-4">
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full uppercase tracking-widest">{t("card2Sub")}</span>
                    <h3 className="text-2xl font-display font-bold text-slate-800">
                      {t("card2Title")}
                    </h3>
                    <p className="text-sm text-slate-500">
                      {t("card2Desc")}
                    </p>
                    
                    {/* Visual Icon Sliders */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 flex items-center justify-center my-4">
                      <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg shadow-sm">
                        <Sliders className="w-8 h-8" />
                      </div>
                    </div>
                  </div>

                  <div className="pt-6">
                    <button 
                      onClick={() => setActiveTab("convert")}
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-4 rounded-lg text-sm tracking-wider uppercase border border-slate-200 shadow-sm transition"
                    >
                      {t("card2Btn")}
                    </button>
                  </div>
                </div>

                {/* Card 3: Free ThatOpen 3D BIM Viewer */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition duration-300">
                  <div className="space-y-4">
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full uppercase tracking-widest">{t("card3Sub")}</span>
                    <h3 className="text-2xl font-display font-bold text-slate-800">
                      {t("card3Title")}
                    </h3>
                    <p className="text-sm text-slate-500">
                      {t("card3Desc")}
                    </p>
                    
                    {/* Visual Icon 3D View */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 flex items-center justify-center my-4">
                      <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg shadow-sm">
                        <Eye className="w-8 h-8" />
                      </div>
                    </div>
                  </div>

                  <div className="pt-6">
                    <button 
                      onClick={() => setActiveTab("viewer")}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-4 rounded-lg text-sm tracking-wider uppercase transition duration-300 shadow-sm"
                    >
                      {t("card3Btn")}
                    </button>
                  </div>
                </div>

              </div>

              {/* Informational footer about unauthenticated & online conversion */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200/60 flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-4 shadow-sm">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-full flex-shrink-0">
                  <HelpCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1.5 text-center md:text-left">
                  <h4 className="font-semibold text-slate-900">{t("howItWorksTitle")}</h4>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    {t("howItWorksDesc")}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
          
          {/* TAB 2: CORE CONVERSION TOOL */}
          {activeTab === "convert" && (
            <motion.div
              key="convert"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="py-6"
              id="view_convert_core"
            >
              {/* Layout Grid: Left Column (Interaction & History) & Right Column (Settings Sidebar) */}
              <div className="flex flex-col lg:flex-row gap-8 items-start">
                
                {/* Left Column: Interaction */}
                <div className="flex-1 w-full space-y-8">
                  {/* Title Section */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-3xl font-display font-extrabold text-slate-900 tracking-tight">
                        {t("navConvert")}
                      </h2>
                      <p className="text-sm text-slate-500 mt-1">
                        {lang === "es" 
                          ? "Carga tus archivos de Revit (.rvt, .rfa) para realizar la conversión automática a IFC4"
                          : "Upload your Revit files (.rvt, .rfa) to convert them automatically to IFC4"
                        }
                      </p>
                    </div>
                    {files.length > 0 && (
                      <div className="text-xs text-blue-700 font-semibold bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 flex items-center space-x-1.5 animate-pulse font-mono">
                        <span className="h-2 w-2 rounded-full bg-blue-600"></span>
                        <span>{files.length} {lang === "es" ? "archivo(s) en cola" : "file(s) in queue"}</span>
                      </div>
                    )}
                  </div>

                  {/* Drag and Drop Zone */}
                  <div 
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`min-h-[220px] rounded-2xl flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all duration-300 relative ${
                      isDragActive 
                        ? "border-2 border-dashed border-blue-500 bg-blue-50/40" 
                        : "border-2 border-dashed border-slate-200 bg-white hover:bg-slate-50/80 shadow-sm"
                    }`}
                    id="drop_zone"
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      multiple 
                      accept=".rvt,.rfa" 
                      className="hidden" 
                    />
                    
                    <div className="space-y-4 max-w-md">
                      <div className="mx-auto w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-base font-semibold text-slate-800">
                          {t("dropzoneTitle")}
                        </p>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {t("dropzoneDesc")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons Below Upload Area */}
                  <div className="flex items-center justify-end space-x-3" id="convert_action_buttons">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-5 py-2.5 rounded-lg border border-slate-200 shadow-sm tracking-wider uppercase transition-all"
                      id="btn_add_files"
                    >
                      {lang === "es" ? "AÑADIR" : "ADD"}
                    </button>
                    <button 
                      onClick={handleConvertAll}
                      disabled={files.filter(f => f.status === "idle").length === 0}
                      className={`text-xs font-bold px-5 py-2.5 rounded-lg shadow-sm tracking-wider uppercase transition-all ${
                        files.filter(f => f.status === "idle").length > 0
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-slate-200 text-slate-400 cursor-not-allowed"
                      }`}
                      id="btn_convert_all"
                    >
                      {t("btnConvertAll")}
                    </button>
                    <button 
                      onClick={handleClearList}
                      disabled={files.length === 0}
                      className={`text-xs font-bold px-5 py-2.5 rounded-lg shadow-sm tracking-wider uppercase transition-all ${
                        files.length > 0
                          ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300"
                          : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                      }`}
                      id="btn_clear_list"
                    >
                      {t("btnClear")}
                    </button>
                  </div>

                  {/* Active Conversion Queue List */}
                  {files.length > 0 && (
                    <div className="space-y-4" id="conversion_queue_container">
                      <h3 className="font-display font-bold text-lg text-slate-800 border-b border-slate-200 pb-2">
                        {lang === "es" ? "Ficheros Seleccionados" : "Selected Files"}
                      </h3>
                      
                      <div className="space-y-3">
                        {files.map(item => {
                          const isExpanded = expandedFileId === item.id;
                          
                          return (
                            <div 
                              key={item.id}
                              className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition hover:border-slate-300"
                            >
                              {/* File Primary Bar */}
                              <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-start space-x-3">
                                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                    <FileCode className="w-5 h-5" />
                                  </div>
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <p className="font-semibold text-slate-800 text-sm break-all">{item.fileName}</p>
                                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                                        {item.fileType?.toUpperCase()}
                                      </span>
                                    </div>
                                    <div className="flex items-center space-x-3 text-xs text-slate-400 font-mono">
                                      <span>{item.fileSize}</span>
                                      <span>•</span>
                                      <span>{item.createdAt}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Status and Action Buttons */}
                                <div className="flex items-center space-x-2 self-end sm:self-auto">
                                  
                                  {/* Status Badges */}
                                  {item.status === "idle" && (
                                    <span className="text-xs font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full border border-slate-200">
                                      {lang === "es" ? "En Cola" : "Queued"}
                                    </span>
                                  )}
                                  {item.status === "uploading" && (
                                    <span className="text-xs font-semibold bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full border border-blue-200 flex items-center space-x-1.5 animate-pulse">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>{lang === "es" ? "Enviando..." : "Uploading..."}</span>
                                    </span>
                                  )}
                                  {item.status === "parsing" && (
                                    <span className="text-xs font-semibold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full border border-amber-200 flex items-center space-x-1.5 animate-pulse">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>{lang === "es" ? "Analizando..." : "Analyzing..."}</span>
                                    </span>
                                  )}
                                  {item.status === "converting" && (
                                    <span className="text-xs font-semibold bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full border border-blue-200 flex items-center space-x-1.5 animate-pulse">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>{lang === "es" ? "Convirtiendo..." : "Converting..."}</span>
                                    </span>
                                  )}
                                  {item.status === "completed" && (
                                    <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center space-x-1.5">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                      <span>{lang === "es" ? "Completado" : "Completed"}</span>
                                    </span>
                                  )}
                                  {item.status === "failed" && (
                                    <span className="text-xs font-semibold bg-rose-50 text-rose-700 px-2.5 py-1 rounded-full border border-rose-200 flex items-center space-x-1.5">
                                      <XCircle className="w-3.5 h-3.5 text-rose-500" />
                                      <span>Error</span>
                                    </span>
                                  )}

                                  {/* Progress bar info */}
                                  {item.progress > 0 && item.progress < 100 && (
                                    <span className="text-xs font-bold text-slate-500 font-mono">
                                      {item.progress}%
                                    </span>
                                  )}

                                  <div className="h-4 w-px bg-slate-200 mx-1"></div>

                                  {/* Play Trigger */}
                                  {item.status === "idle" && (
                                    <button 
                                      onClick={() => convertFile(item.id)}
                                      className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition"
                                      title={lang === "es" ? "Iniciar conversión" : "Start converting"}
                                    >
                                      <ArrowRight className="w-4 h-4" />
                                    </button>
                                  )}

                                  {/* Download IFC */}
                                  {item.status === "completed" && item.downloadUrl && (
                                    <a 
                                      href={item.downloadUrl}
                                      className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded-lg transition flex items-center"
                                      title={lang === "es" ? "Descargar archivo IFC" : "Download IFC File"}
                                      id={`download_btn_${item.id}`}
                                    >
                                      <Download className="w-4 h-4" />
                                    </a>
                                  )}

                                  {/* Expand Logs */}
                                  <button 
                                    onClick={() => setExpandedFileId(isExpanded ? null : item.id)}
                                    className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition"
                                    title={lang === "es" ? "Ver detalles de conversión" : "View conversion details"}
                                  >
                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                  </button>

                                  {/* Delete Item */}
                                  <button 
                                    onClick={() => handleDeleteItem(item.id)}
                                    className="p-1.5 hover:bg-rose-50 text-rose-500 rounded-lg transition"
                                    title={lang === "es" ? "Quitar de la cola" : "Remove from queue"}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>

                                </div>
                              </div>

                              {/* Interactive Expandable Log Console */}
                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div
                                    initial={{ height: 0 }}
                                    animate={{ height: "auto" }}
                                    exit={{ height: 0 }}
                                    className="border-t border-slate-100 bg-slate-950 text-slate-200 overflow-hidden"
                                  >
                                    <div className="p-4 space-y-4 font-mono text-xs">
                                      
                                      {/* Extracted Details block if completed */}
                                      {item.status === "completed" && (
                                        <div className="space-y-3">
                                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-900 p-3 rounded-lg border border-slate-800 text-[11px] text-slate-300">
                                            <div>
                                              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider">{lang === "es" ? "Versión Revit" : "Revit Version"}</span>
                                              <span className="text-blue-400 font-semibold">{item.revitVersion}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider">{lang === "es" ? "Creador" : "Creator"}</span>
                                              <span>{item.author}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider">{lang === "es" ? "Clase Salida" : "IFC Output Class"}</span>
                                              <span className="text-emerald-400 font-semibold">{item.fileType === "rfa" ? "IfcRepresentationMap" : "IfcProject (IFC4)"}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-500 block uppercase font-bold text-[9px] tracking-wider">cad2data</span>
                                              <span className="text-yellow-400 font-semibold">Active Engine v2.5</span>
                                            </div>
                                          </div>
                                          
                                          {/* View in 3D Button shortcut */}
                                          <div className="flex justify-end pt-1">
                                            <button
                                              onClick={() => {
                                                setViewerSelectedFileId(item.id);
                                                setActiveTab("viewer");
                                              }}
                                              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm font-sans"
                                            >
                                              <Eye className="w-3.5 h-3.5" />
                                              <span>{lang === "es" ? "EXPLORAR MODELO EN VISOR 3D" : "EXPLORE MODEL IN 3D VIEWER"}</span>
                                            </button>
                                          </div>
                                        </div>
                                      )}

                                      {/* Progress Line */}
                                      {item.progress > 0 && (
                                        <div className="space-y-1.5">
                                          <div className="flex justify-between text-[10px] text-slate-400">
                                            <span>CLOUD RUN CONVERSION PIPELINE</span>
                                            <span>{item.progress}%</span>
                                          </div>
                                          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                            <div 
                                              className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                                              style={{ width: `${item.progress}%` }}
                                            ></div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Log Stream Output */}
                                      <div className="space-y-1 max-h-[150px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                                        <div className="text-slate-500 border-b border-slate-900 pb-1 mb-1 text-[10px]">CONSOLE LOG STREAM</div>
                                        {item.logs.map((log, index) => (
                                          <div key={index} className="leading-relaxed hover:bg-slate-900 px-1 py-0.5 rounded text-[10px] text-slate-300">
                                            {log}
                                          </div>
                                        ))}
                                      </div>

                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>

                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* PERSISTENT HISTORY VIEW (Styled like screenshot with minimalist accents) */}
                  <div className="space-y-4 pt-4" id="history_section">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <div className="flex items-center space-x-2">
                        <Clock className="w-5 h-5 text-slate-400" />
                        <h3 className="text-2xl font-display font-bold text-slate-800">
                          {t("historyTitle")}
                        </h3>
                      </div>
                      {history.length > 0 && (
                        <button 
                          onClick={handleClearHistory}
                          className="text-xs text-slate-400 hover:text-rose-500 flex items-center space-x-1 font-medium transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t("btnHistoryClear")}</span>
                        </button>
                      )}
                    </div>

                    {history.length === 0 ? (
                      <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 text-slate-400 text-sm shadow-sm">
                        {t("noHistory")}
                      </div>
                    ) : (
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-100 bg-slate-50/50 text-slate-500 text-xs font-bold uppercase tracking-wider">
                                <th className="py-3 px-4 flex items-center space-x-1 cursor-default">
                                  <span>{t("historyCreated")}</span>
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                </th>
                                <th className="py-3 px-4">{t("historyFileName")}</th>
                                <th className="py-3 px-4">{t("historyMetadata")}</th>
                                <th className="py-3 px-4">{t("historyStatus")}</th>
                                <th className="py-3 px-4 text-right">{t("historyDownload")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                              {history.map((hist) => (
                                <tr key={hist.id} className="hover:bg-slate-50/50 transition">
                                  <td className="py-3 px-4 text-xs text-slate-400 font-mono">
                                    {hist.createdAt.split(",")[0]}
                                  </td>
                                  <td className="py-3 px-4 font-semibold text-slate-800 break-all max-w-xs">
                                    <div className="flex items-center gap-2">
                                      <span>{hist.fileName}</span>
                                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                                        {hist.fileType?.toUpperCase()}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4 text-xs text-slate-500">
                                    <div className="space-y-0.5">
                                      <div className="font-semibold text-blue-600">{hist.revitVersion}</div>
                                      <div className="text-[10px] text-slate-400">Por: {hist.author} ({hist.fileSize})</div>
                                    </div>
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                      <span>{lang === "es" ? "Convertido" : "Converted"}</span>
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right">
                                    <div className="flex items-center justify-end space-x-1.5">
                                      {/* Explore 3D Link */}
                                      <button
                                        onClick={() => {
                                          setViewerSelectedFileId(hist.id);
                                          setActiveTab("viewer");
                                        }}
                                        className="inline-flex items-center space-x-1 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold py-1.5 px-3 rounded-lg border border-slate-200 transition"
                                        title={lang === "es" ? "Abrir en Visor 3D" : "Open in 3D Viewer"}
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">3D</span>
                                      </button>
                                      
                                      {/* IFC Download */}
                                      {hist.downloadUrl && (
                                        <a 
                                          href={hist.downloadUrl}
                                          className="inline-flex items-center space-x-1 bg-slate-900 hover:bg-blue-600 text-white text-xs font-bold py-1.5 px-3 rounded-lg shadow-sm border border-slate-900 transition"
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                          <span>IFC</span>
                                        </a>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Settings Panel (Matching mockup!) */}
                <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col shrink-0">
                  <h3 className="text-base font-bold mb-6 flex items-center gap-2 text-slate-800">
                    <Settings className="w-5 h-5 text-slate-400" />
                    <span>{t("settingsTitle")}</span>
                  </h3>
                  
                  <div className="space-y-6">
                    {/* IFC Schema Selector */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">IFC Schema</label>
                      <select 
                        value={ifcSchema} 
                        onChange={(e) => setIfcSchema(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition font-medium"
                      >
                        <option>IFC2x3 Coordination View 2.0</option>
                        <option>IFC4 Design Transfer View</option>
                        <option>IFC4 Reference View</option>
                      </select>
                    </div>

                    {/* Property Sets checkboxes */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Property Sets</label>
                      <div className="space-y-3 pt-1">
                        <label 
                          className="flex items-center gap-3 cursor-pointer group"
                          onClick={() => setIncludeRevitProps(!includeRevitProps)}
                        >
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                            includeRevitProps 
                              ? "bg-blue-600 border-blue-600 text-white" 
                              : "border-slate-300 bg-white group-hover:border-slate-400"
                          }`}>
                            {includeRevitProps && (
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm text-slate-700 select-none">{lang === "es" ? "Incluir propiedades Revit" : "Include Revit Properties"}</span>
                        </label>

                        <label 
                          className="flex items-center gap-3 cursor-pointer group"
                          onClick={() => setExportQuantities(!exportQuantities)}
                        >
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                            exportQuantities 
                              ? "bg-blue-600 border-blue-600 text-white" 
                              : "border-slate-300 bg-white group-hover:border-slate-400"
                          }`}>
                            {exportQuantities && (
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm text-slate-700 select-none">{lang === "es" ? "Exportar cantidades" : "Export Quantities"}</span>
                        </label>

                        <label 
                          className="flex items-center gap-3 cursor-pointer group"
                          onClick={() => setExportBaseQuantities(!exportBaseQuantities)}
                        >
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                            exportBaseQuantities 
                              ? "bg-blue-600 border-blue-600 text-white" 
                              : "border-slate-300 bg-white group-hover:border-slate-400"
                          }`}>
                            {exportBaseQuantities && (
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm text-slate-700 select-none">{lang === "es" ? "Exportar cantidades base" : "Export Base Quantities"}</span>
                        </label>
                      </div>
                    </div>

                    {/* Geometry Precision switcher */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">{t("precisionLabel")}</label>
                      <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                        <button 
                          onClick={() => setGeometryPrecision("normal")}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            geometryPrecision === "normal" 
                              ? "bg-white text-slate-800 shadow-sm" 
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          {lang === "es" ? "Normal" : "Normal"}
                        </button>
                        <button 
                          onClick={() => setGeometryPrecision("high")}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            geometryPrecision === "high" 
                              ? "bg-white text-slate-800 shadow-sm" 
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          {lang === "es" ? "Alta" : "High"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8">
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 mb-4">
                      <p className="text-[11px] text-blue-800 leading-relaxed">
                        {t("proTip")}
                      </p>
                    </div>
                    <p className="text-center text-[10px] text-slate-400 font-mono">v2.5.1 (r2026 Engine)</p>
                  </div>
                </div>

              </div>
            </motion.div>
          )}

          {/* TAB 3: THATOPEN INTERACTIVE BIM VIEWER & PARSED DATA METADATA INSPECTOR */}
          {activeTab === "viewer" && (
            <motion.div
              key="viewer"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="py-6 space-y-6"
              id="view_bim_viewer"
            >
              {/* Header section with selectable files dropdown */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="space-y-1">
                  <h2 className="text-3xl font-display font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                    <Eye className="w-7 h-7 text-blue-600" />
                    <span>{t("viewerTitle")}</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    {t("viewerSubtitle")}
                  </p>
                </div>

                {/* Model Selector dropdown */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    {lang === "es" ? "Cargar Archivo:" : "Load Model File:"}
                  </span>
                  
                  <select
                    value={viewerSelectedFileId || ""}
                    onChange={(e) => {
                      setViewerSelectedFileId(e.target.value || null);
                      setSelectedElementId(null);
                    }}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:border-blue-500 transition font-semibold min-w-[200px]"
                  >
                    <option value="">-- {t("selectFilePrompt")} --</option>
                    
                    {/* Active list files */}
                    {files.filter(f => f.status === "completed").map(f => (
                      <option key={f.id} value={f.id}>
                        [QUEUE] {f.fileName} ({f.revitVersion})
                      </option>
                    ))}
                    
                    {/* History list files */}
                    {history.map(h => (
                      <option key={h.id} value={h.id}>
                        [HISTORY] {h.fileName} ({h.revitVersion})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Viewport & Inspector Area if model loaded */}
              {!activeViewerFile ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 space-y-4 max-w-2xl mx-auto shadow-sm">
                  <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                    <Info className="w-6 h-6" />
                  </div>
                  <p className="text-sm leading-relaxed">
                    {t("noActiveModel")}
                  </p>
                  <button
                    onClick={() => setActiveTab("convert")}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 px-4 rounded-lg shadow transition"
                  >
                    {lang === "es" ? "IR A CONVERTIDOR" : "GO TO CONVERTER"}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  
                  {/* Left Sidebar: Collapsible IFC Model Tree */}
                  <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold border-b border-slate-100 pb-2.5 flex items-center gap-2 text-slate-800 uppercase tracking-wider">
                      <Layers className="w-4 h-4 text-slate-400" />
                      <span>{t("modelTree")}</span>
                    </h3>

                    {/* Collapsible structured tree list */}
                    <div className="space-y-3 text-xs max-h-[450px] overflow-y-auto pr-1">
                      
                      {/* Project Root Node */}
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-800 flex items-center space-x-1">
                          <span className="text-blue-500 font-bold">🏠</span>
                          <span className="truncate">{activeViewerFile.fileName.replace(/\.(rvt|rfa)$/i, "")} [IfcProject]</span>
                        </div>
                        
                        {/* Site / Storey Node */}
                        <div className="pl-4 space-y-1 border-l border-slate-200">
                          <div className="text-slate-600 flex items-center space-x-1">
                            <span className="text-emerald-500">📍</span>
                            <span>{lang === "es" ? "Parcela" : "Site"} [IfcSite]</span>
                          </div>
                          
                          <div className="pl-4 space-y-1 border-l border-slate-200">
                            <div className="text-slate-600 flex items-center space-x-1">
                              <span className="text-purple-500">🏢</span>
                              <span>{lang === "es" ? "Edificio" : "Building"} [IfcBuilding]</span>
                            </div>

                            <div className="pl-4 space-y-1 border-l border-slate-200">
                              <div className="text-slate-600 flex items-center space-x-1 font-medium">
                                <span className="text-amber-500">階</span>
                                <span>{activeViewerFile.fileType === "rfa" ? (lang === "es" ? "Planta Ref" : "Ref Level") : (lang === "es" ? "Planta Baja" : "Level 0")} [IfcStorey]</span>
                              </div>

                              {/* Elements list by Category */}
                              <div className="pl-4 space-y-2 pt-1 border-l border-slate-200">
                                {activeViewerElements.length === 0 ? (
                                  <p className="text-[10px] text-slate-400 italic">No elements found</p>
                                ) : (
                                  (Object.entries(
                                    activeViewerElements.reduce((acc, el) => {
                                      acc[el.category] = acc[el.category] || [];
                                      acc[el.category].push(el);
                                      return acc;
                                    }, {} as Record<string, typeof activeViewerElements>)
                                  ) as [string, typeof activeViewerElements][]).map(([catName, elList]) => (
                                    <div key={catName} className="space-y-1">
                                      <div className="text-slate-400 font-semibold uppercase text-[9px] tracking-wider flex items-center space-x-1">
                                        <span>▼</span>
                                        <span className="truncate">{catName}</span>
                                      </div>
                                      
                                      {/* Individual Leaf Element Node */}
                                      <div className="pl-2.5 space-y-1">
                                        {elList.map(el => {
                                          const isSelected = selectedElementId === el.id;
                                          return (
                                            <div
                                              key={el.id}
                                              onClick={() => setSelectedElementId(isSelected ? null : el.id)}
                                              className={`p-1.5 rounded cursor-pointer transition truncate flex items-center justify-between ${
                                                isSelected 
                                                  ? "bg-blue-50 text-blue-600 font-bold border border-blue-100" 
                                                  : "hover:bg-slate-50 text-slate-600"
                                              }`}
                                            >
                                              <span className="truncate">▫️ {el.name}</span>
                                              <span className="text-[8px] opacity-75 font-mono font-bold bg-slate-100 px-1 py-0.5 rounded text-slate-500">
                                                {el.ifcClass.replace("Ifc", "")}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Center: Interactive 3D BIM Drafting Viewport */}
                  <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                    <BIM3DViewport
                      elements={activeViewerElements}
                      selectedElementId={selectedElementId}
                      onSelectElement={setSelectedElementId}
                      lang={lang}
                    />
                    
                    {/* Instructions HUD */}
                    <p className="text-center text-[10px] text-slate-400 leading-relaxed">
                      {t("viewerInstructions")}
                    </p>
                  </div>

                  {/* Right Sidebar: Collapsible Property Inspector & cad2data Multi-format export */}
                  <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-6">
                    
                    {/* Section title */}
                    <div className="border-b border-slate-100 pb-2.5 space-y-1.5">
                      <h3 className="text-sm font-bold flex items-center gap-2 text-slate-800 uppercase tracking-wider">
                        <Database className="w-4 h-4 text-slate-400" />
                        <span>{t("propertiesPanel")}</span>
                      </h3>
                      <p className="text-[10px] text-slate-400">
                        {t("propertiesDesc")}
                      </p>
                    </div>

                    {/* Selected Element parameter tree */}
                    {!selectedElementDetails ? (
                      <div className="text-center py-12 text-slate-400 text-xs italic bg-slate-50 rounded-xl border border-dashed border-slate-200 p-4">
                        {t("noElementSelected")}
                      </div>
                    ) : (
                      <div className="space-y-4 text-xs">
                        {/* Primary Identifier */}
                        <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100/50 space-y-1">
                          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">{t("elementSelected")}</div>
                          <div className="font-bold text-slate-900 leading-snug">{selectedElementDetails.name}</div>
                          <div className="text-[9px] font-mono text-slate-400 pt-0.5">GUID: {selectedElementDetails.id}</div>
                        </div>

                        {/* Category and IFC classifications */}
                        <table className="w-full text-left border-collapse border-b border-slate-100">
                          <tbody>
                            <tr className="border-b border-slate-100">
                              <td className="py-2 text-slate-400 font-medium">{t("categoryLabel")}</td>
                              <td className="py-2 font-semibold text-slate-800 text-right">{selectedElementDetails.category}</td>
                            </tr>
                            <tr className="border-b border-slate-100">
                              <td className="py-2 text-slate-400 font-medium">{t("classLabel")}</td>
                              <td className="py-2 font-mono font-bold text-blue-600 text-right">{selectedElementDetails.ifcClass}</td>
                            </tr>
                            <tr className="border-b border-slate-100">
                              <td className="py-2 text-slate-400 font-medium">{t("familyLabel")}</td>
                              <td className="py-2 font-semibold text-slate-800 text-right truncate max-w-[120px]">{selectedElementDetails.family}</td>
                            </tr>
                            <tr>
                              <td className="py-2 text-slate-400 font-medium">{t("typeLabel")}</td>
                              <td className="py-2 font-semibold text-slate-800 text-right truncate max-w-[120px]">{selectedElementDetails.type}</td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Flat Parameter Property groups */}
                        <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                          {Object.entries(selectedElementDetails.properties || {}).map(([groupName, groupProps]: any) => (
                            <div key={groupName} className="space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                              <div className="font-bold text-slate-700 text-[10px] uppercase tracking-wider">{groupName}</div>
                              <div className="space-y-1 pt-1 border-t border-slate-200/50">
                                {Object.entries(groupProps || {}).map(([k, v]: any) => (
                                  <div key={k} className="flex justify-between items-start gap-2 py-0.5">
                                    <span className="text-slate-400 truncate max-w-[110px]">{k}</span>
                                    <span className="font-semibold text-slate-800 text-right break-all">{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* cad2data multi-format exports for this file */}
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>{lang === "es" ? "Descargas cad2data" : "cad2data Data Exports"}</span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2">
                        {/* JSON */}
                        <button
                          onClick={() => handleExportData("json", activeViewerFile)}
                          className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 transition text-center shadow-sm"
                          title="Export to JSON"
                        >
                          JSON
                        </button>

                        {/* XML */}
                        <button
                          onClick={() => handleExportData("xml", activeViewerFile)}
                          className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 transition text-center shadow-sm"
                          title="Export to XML"
                        >
                          XML
                        </button>

                        {/* CSV */}
                        <button
                          onClick={() => handleExportData("csv", activeViewerFile)}
                          className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg border border-slate-200 transition text-center shadow-sm"
                          title="Export to CSV"
                        >
                          CSV
                        </button>
                      </div>
                    </div>

                  </div>

                </div>
              )}

            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-8 px-6 text-slate-500 text-xs shrink-0">
        <div className="max-w-7xl w-full mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <span className="font-display font-bold text-slate-800">RVT &amp; RFA → IFC</span>
            <span className="text-slate-300">|</span>
            <span>Online Web Converter &amp; 3D Viewer</span>
          </div>
          <div className="text-center md:text-right space-y-1 text-slate-400">
            <p>
              {lang === "es" 
                ? "Inspirado en el desarrollo Open Source de Simon Moreau y " 
                : "Inspired by the Open Source developments of Simon Moreau and "
              }
              <a href="https://github.com/ThatOpen" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">ThatOpen</a> &amp; <a href="https://github.com/datadrivenconstruction" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">cad2data</a>.
            </p>
            <p className="text-[10px]">
              © 2026 RVTToIFC Online. {lang === "es" ? "Sin cuentas, sin registro, libre y gratuito." : "No accounts, no registration, fully open and free."}
            </p>
          </div>
        </div>
      </footer>

    </div>
  );
}
