import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai"; // Importamos la librería oficial de Google

// Inicializamos el cliente de Inteligencia Artificial usando la API Key de las variables de entorno
// Se usa la versión compatible con el SDK moderno de Google AI
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || "" });

const conversionStorage = new Map<string, { filename: string; content: string; metadata: any; elements: any[] }>();

// Tu función extractora original (mantiene la lectura de cabeceras OLE)
function extractRevitMetadata(buffer: Buffer, originalFileName: string): {
  version: string;
  projectName: string;
  author: string;
  fileSize: string;
  fileType: "rvt" | "rfa";
  isValidRevit: boolean;
} {
  const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
  const isRfa = originalFileName.toLowerCase().endsWith(".rfa");
  const fileType: "rvt" | "rfa" = isRfa ? "rfa" : "rvt";
  
  const sampleSize = Math.min(buffer.length, 2 * 1024 * 1024);
  const headSample = buffer.subarray(0, sampleSize).toString("utf16le");
  const tailSample = buffer.length > sampleSize
    ? buffer.subarray(buffer.length - sampleSize).toString("utf16le")
    : "";

  const fullSample = headSample + "\n---TAIL---\n" + tailSample;
  
  const hasRevitIndicator = 
    buffer.includes(Buffer.from("B\0a\0s\0i\0c\0F\0i\0l\0e\0I\0n\0f\0o\0", "utf-8")) || 
    fullSample.includes("Autodesk Revit") ||
    fullSample.includes("Revit Build") ||
    fullSample.includes("Format:");

  const versionMatch = fullSample.match(/Autodesk\s+Revit\s+(\d{4})/i) ||
                       fullSample.match(/Format:\s*(\d{4})/i) ||
                       fullSample.match(/Revit\s*Build.*?(\d{4})/i);
  
  let detectedYear = 2026;
  if (versionMatch) {
    detectedYear = parseInt(versionMatch[1]);
  }
  
  const version = `Autodesk Revit ${detectedYear}`;

  const usernameMatch = fullSample.match(/Username:\s*([^\r\n\0]+)/i) || 
                        fullSample.match(/Creado\s+por:\s*([^\r\n\0]+)/i);
  const author = usernameMatch ? usernameMatch[1].trim() : "Usuario BIM";

  let projectName = isRfa ? "FamiliaRevit" : "ProyectoRevit";
  const centralPathMatch = fullSample.match(/Central\s+Model\s+Path:\s*([^\r\n\0]+)/i);
  if (centralPathMatch) {
    const pathStr = centralPathMatch[1].trim();
    const baseName = pathStr.split(/[\\/]/).pop();
    if (baseName && (baseName.endsWith(".rvt") || baseName.endsWith(".rfa"))) {
      projectName = baseName.replace(/\.(rvt|rfa)$/i, "");
    }
  }

  return { version, projectName, author, fileSize: `${sizeMB} MB`, fileType, isValidRevit: hasRevitIndicator || buffer.length > 50000 };
}

// Generador dinámico de IFC en formato STEP (toma los datos procesados por la IA)
function generateIFCContent(projectName: string, author: string, revitVersion: string, fileSizeMB: string, elements: any[]): string {
  const currentDate = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const guid1 = "3Gz8vA$7PB2v1rX6$R" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const guid2 = "1Xy9zB$8PC3w2sY7$S" + Math.random().toString(36).substring(2, 8).toUpperCase();
  
  let dataLines = [
    `#1= IFCORGANIZATION($,'CAD2Data AI Engine (Gemini Powered)',$,$,$);`,
    `#2= IFCAPPLICATION(#1,'3.0.0','AI BIM Converter','cad2data');`,
    `#3= IFCPERSON($,'${author}',$,$,$,$,$,$);`,
    `#4= IFCPERSONANDORGANIZATION(#3,#1,$);`,
    `#5= IFCOWNERHISTORY(#4,#2,$,.ADDED.,$,$,$,${Math.floor(Date.now() / 1000)});`,
    `#10= IFCDIRECTION((0.,0.,1.));`,
    `#11= IFCDIRECTION((1.,0.,0.));`,
    `#12= IFCCARTESIANPOINT((0.,0.,0.));`,
    `#13= IFCAX2PLACEMENT3D(#12,#10,#11);`,
    `#20= IFCPROJECT('${guid1}',#5,'${projectName}','AI Generated IFC from ${projectName} (${fileSizeMB})',$,$,$,(#30),#40);`,
    `#30= IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#13,$);`,
    `#40= IFCUNITASSIGNMENT((#41,#42,#43));`,
    `#41= IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`,
    `#42= IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`,
    `#43= IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`,
    `#50= IFCBUILDING('${guid2}',#5,'${projectName} Edificio','Modelo IFC interpretado con IA desde ${revitVersion}',$,#13,$,$,.ELEMENT.);`,
    `#60= IFCSITE('2B$9zC_8PD3w2sZ8$T',#5,'Parcela Principal','Coordenadas AI',$,#13,$,$,.ELEMENT.,$,$,$,$,$);`,
    `#70= IFCBUILDINGSTOREY('3C$9zD_8PE3w2sA9$U',#5,'Nivel 1','Planta Interpretada por IA',$,#13,$,$,.ELEMENT.,0.0);`
  ];

  let idx = 100;
  let elementIds: string[] = [];
  
  elements.forEach((el) => {
    const elGuid = "2Wg9zD_8PE3w2s" + (idx).toString().padEnd(6, "A");
    const ifcClass = (el.ifcClass || "IfcBuildingElementProxy").toUpperCase();
    const cleanName = (el.name || "Elemento AI").replace(/'/g, "''");
    const cleanType = (el.type || "Generico").replace(/'/g, "''");
    
    dataLines.push(`#${idx}= ${ifcClass}('${elGuid}',#5,'${cleanName}','${cleanType}',$,#13,$,$);`);
    elementIds.push(`#${idx}`);
    
    const psetGuid = "3Ah9zE_8PE3w" + (idx + 1).toString().padEnd(6, "B");
    let propLines: string[] = [];
    let propIndex = idx + 10;
    
    Object.entries(el.properties || {}).forEach(([groupName, groupProps]: [string, any]) => {
      if (typeof groupProps === 'object' && groupProps !== null) {
        Object.entries(groupProps).forEach(([propName, propVal]: [string, any]) => {
          dataLines.push(`#${propIndex}= IFCPROPERTYSINGLEVALUE('${propName.replace(/'/g, "''")}',$,IFCLABEL('${String(propVal).replace(/'/g, "''")}'),$);`);
          propLines.push(`#${propIndex}`);
          propIndex++;
        });
      }
    });
    
    if (propLines.length > 0) {
      const catClean = (el.category || "General").split(" / ")[0];
      dataLines.push(`#${idx + 1}= IFCPROPERTYSET('${psetGuid}',#5,'Pset_${catClean}Common',$,(${propLines.join(",")}));`);
      dataLines.push(`#${idx + 2}= IFCRELDEFINESBYPROPERTIES('4Bi9zF_8PE3w${idx}C',#5,$,$,(#${idx}),#${idx + 1});`);
    }
    
    idx += 50;
  });

  if (elementIds.length > 0) {
    dataLines.push(`#900= IFCRELCONTAINEDINSPATIALSTRUCTURE('1Yp9zD_8PE3w2sB9$V',#5,'Contencion IA','Elementos estructurados por Gemini',(${elementIds.join(",")}),#70);`);
  }

  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('${projectName}.ifc','${currentDate}',('${author}'),(),'AI Revit Engine','${revitVersion}','Approved');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${dataLines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "100mb" }));

  // Ruta de conversión inteligente con Gemini
  app.post(
    "/api/convert", 
    express.raw({ limit: "100mb", type: "application/octet-stream" }), 
    async (req, res) => {
      try {
        const buffer = req.body as Buffer;
        const fileNameHeader = req.headers["x-file-name"];
        const originalFileName = fileNameHeader ? decodeURIComponent(fileNameHeader as string) : "modelo.rvt";

        if (!buffer || buffer.length === 0) {
          return res.status(400).json({ error: "Archivo vacío." });
        }

        const metadata = extractRevitMetadata(buffer, originalFileName);
        
        if ((metadata.projectName === "ProyectoRevit" || metadata.projectName === "FamiliaRevit") && originalFileName) {
          metadata.projectName = originalFileName.replace(/\.(rvt|rfa)$/i, "");
        }

        // --- INTEGRACIÓN CON GEMINI ---
        // Le pasamos las cadenas de texto del archivo a la IA para que las interprete
        const sampleSize = Math.min(buffer.length, 1 * 1024 * 1024);
        const textDump = buffer.subarray(0, sampleSize).toString("utf8").replace(/[^\x20-\x7E\s]/g, "");

        let elements = [];
        
        if (process.env.GOOGLE_API_KEY) {
          try {
            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: `Analiza el siguiente volcado de texto crudo de un archivo de Revit (.rvt/.rfa). 
              Tu objetivo es identificar las familias de objetos, componentes BIM, muros, puertas, ventanas, mobiliarios o parámetros que se mencionen de manera consistente.
              Devuelve la respuesta ESTRICTAMENTE en formato JSON plano (un arreglo de objetos). No agregues texto explicativo ni bloques de código markdown.
              
              Cada objeto del arreglo debe cumplir este esquema estricto:
              {
                "id": "string único",
                "name": "Nombre descriptivo del elemento encontrado",
                "category": "Categoría arquitectónica en español",
                "ifcClass": "Clase IFC4 válida (ej: IfcWallStandardCase, IfcDoor, IfcWindow, IfcSlab, IfcColumn, IfcFurniture)",
                "type": "Tipo o familia",
                "properties": {
                  "Dimensiones": { "Parametro": "Valor aproximado o inferido" },
                  "Datos de Identidad": { "Creador": "${metadata.author}" }
                }
              }

              Volcado de texto a analizar:
              ${textDump.substring(0, 30000)}` // Limitamos para no desbordar los tokens
            });

            const rawText = response.text || "[]";
            const cleanJson = rawText.replace(/```json|```/g, "").trim();
            elements = JSON.parse(cleanJson);
          } catch (aiErr) {
            console.error("Error llamando a Gemini, usando generador básico:", aiErr);
          }
        }

        // Si la IA falla o no hay API Key, creamos un elemento genérico por defecto
        if (!elements || elements.length === 0) {
          elements = [{
            id: "el_gen_1",
            name: `Entidad General - ${metadata.projectName}`,
            category: "Modelado General",
            ifcClass: "IfcBuildingElementProxy",
            type: "Estructura Interpretada",
            properties: { "Datos": { "Nota": "Procesado en modo local sin API Key activa" } }
          }];
        }

        const conversionId = "conv_" + Math.random().toString(36).substring(2, 15);
        const ifcFileName = `${metadata.projectName}.ifc`;
        const ifcContent = generateIFCContent(metadata.projectName, metadata.author, metadata.version, metadata.fileSize, elements);

        conversionStorage.set(conversionId, {
          filename: ifcFileName,
          content: ifcContent,
          metadata,
          elements
        });

        res.json({
          success: true,
          id: conversionId,
          metadata,
          elements,
          ifcFileName
        });
      } catch (err: any) {
        console.error("Error en conversión:", err);
        res.status(500).json({ error: "Error interno: " + err.message });
      }
    }
  );

  // Descarga del IFC generado
  app.get("/api/download/:id", (req, res) => {
    const id = req.params.id;
    const fileData = conversionStorage.get(id);
    if (!fileData) return res.status(404).send("La conversión caducó o no existe.");

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileData.filename)}"`);
    res.send(fileData.content);
  });

  // Endpoints de utilidad extras
  app.get("/api/elements/:id", (req, res) => {
    const fileData = conversionStorage.get(req.params.id);
    if (!fileData) return res.status(404).json({ error: "No encontrado" });
    res.json({ metadata: fileData.metadata, elements: fileData.elements });
  });

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Configuración de Vite para producción y desarrollo
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Server en puerto ${PORT}`));
}

startServer();
