import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import IfcAPI from "web-ifc";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || "" });
const conversionStorage = new Map<string, { filename: string; content: Uint8Array; metadata: any; elements: any[] }>();

function extractRevitMetadata(buffer: Buffer, originalFileName: string) {
  const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
  const isRfa = originalFileName.toLowerCase().endsWith(".rfa");
  const fileType = isRfa ? "rfa" : "rvt";
  
  const sampleSize = Math.min(buffer.length, 1 * 1024 * 1024);
  const fullSample = buffer.subarray(0, sampleSize).toString("utf16le");
  
  const versionMatch = fullSample.match(/Autodesk\s+Revit\s+(\d{4})/i) || fullSample.match(/Format:\s*(\d{4})/i);
  const version = `Autodesk Revit ${versionMatch ? versionMatch[1] : "2026"}`;
  
  return { version, projectName: originalFileName.replace(/\.(rvt|rfa)$/i, ""), author: "Usuario BIM", fileSize: `${sizeMB} MB`, fileType };
}

// NUEVO MOTOR GEOMÉTRICO 3D (Genera sólidos reales usando web-ifc de forma asíncrona)
async function generateReal3DIFC(projectName: string, elements: any[]): Promise<Uint8Array> {
  let IfcConstructor;
  if ((IfcAPI as any).PlutusAPI) {
    IfcConstructor = (IfcAPI as any).PlutusAPI;
  } else if ((IfcAPI as any).IfcAPI) {
    IfcConstructor = (IfcAPI as any).IfcAPI;
  } else if (typeof IfcAPI === 'function') {
    IfcConstructor = IfcAPI;
  } else {
    IfcConstructor = IfcAPI;
  }

  const localIfcApi = new IfcConstructor();
  
  // SOLUCIÓN DEFINITIVA PARA RENDER:
  // En lugar de confiar en 'SetWasmPath' que duplica rutas en Linux, localizamos el archivo WASM 
  // usando el directorio de ejecución actual de Node (process.cwd()) y lo leemos manualmente.
  const rootDir = process.cwd();
  const wasmFilePath = path.join(rootDir, "node_modules", "web-ifc", "web-ifc-node.wasm");
  
  if (!fs.existsSync(wasmFilePath)) {
    throw new Error(`No se encontró el archivo WASM requerido en la ruta: ${wasmFilePath}`);
  }

  const wasmBinary = fs.readFileSync(wasmFilePath);

  // Inicializar el módulo web-ifc inyectándole directamente el binario cargado por 'fs'
  await localIfcApi.Init(wasmBinary);
  
  // 1. Crear un modelo IFC en blanco en la memoria del servidor
  const modelID = localIfcApi.CreateModel();

  // 2. Definir unidades básicas (Metros)
  const lengthUnit = new localIfcApi.IFC4.IfcSIUnit(localIfcApi.IFC4.IfcSUnitEnum.LENGTHUNIT, null, localIfcApi.IFC4.IfcSIPrefix.NONE, localIfcApi.IFC4.IfcSIUnitName.METRE);
  const unitAssignment = new localIfcApi.IFC4.IfcUnitAssignment([lengthUnit]);
  
  // 3. Crear el proyecto raíz, sitio y edificio reales en la base de datos geométrica
  const ownerHistory = new localIfcApi.IFC4.IfcOwnerHistory(null, null, null, localIfcApi.IFC4.IfcChangeActionEnum.ADDED, null, null, null, Math.floor(Date.now() / 1000));
  const project = new localIfcApi.IFC4.IfcProject("3Gz8vA$7PB2v1rX6$Raaaaa", ownerHistory, projectName, "Convertido por IA con Geometria Real", null, null, null, null, unitAssignment);
  localIfcApi.WriteLine(modelID, project);

  const site = new localIfcApi.IFC4.IfcSite("2B$9zC_8PD3w2sZ8$Taaaaa", ownerHistory, "Parcela", "Coordenadas base", null, null, null, null, localIfcApi.IFC4.IfcElementCompositionEnum.ELEMENT, null, null, null, null, null);
  localIfcApi.WriteLine(modelID, site);

  const building = new localIfcApi.IFC4.IfcBuilding("1Xy9zB$8PC3w2sY7$Saaaaa", ownerHistory, "Edificio Generado", "Estructura 3D", null, null, null, null, localIfcApi.IFC4.IfcElementCompositionEnum.ELEMENT, null, null, null);
  localIfcApi.WriteLine(modelID, building);

  // Posicionamiento geométrico inicial (0,0,0)
  const origin = new localIfcApi.IFC4.IfcCartesianPoint([0, 0, 0]);
  const axis = new localIfcApi.IFC4.IfcDirection([0, 0, 1]);
  const refDirection = new localIfcApi.IFC4.IfcDirection([1, 0, 0]);
  const placement = new localIfcApi.IFC4.IfcAxis2Placement3D(origin, axis, refDirection);
  const localPlacement = new localIfcApi.IFC4.IfcLocalPlacement(null, placement);
  localIfcApi.WriteLine(modelID, localPlacement);

  let currentX = 0.0; // Desplazamiento secuencial en el espacio para que los objetos no se solapen

  // 4. Mapear cada elemento detectado por la IA en un SÓLIDO 3D REAL (Extrusión paramétrica)
  elements.forEach((el) => {
    const width = parseFloat(el.properties?.Dimensiones?.Espesor || el.properties?.Dimensiones?.Ancho || "0.3");
    const length = parseFloat(el.properties?.Dimensiones?.Largo || "4.0");
    const height = parseFloat(el.properties?.Dimensiones?.Altura || "3.0");

    const point1 = new localIfcApi.IFC4.IfcCartesianPoint([0, 0]);
    const point2 = new localIfcApi.IFC4.IfcCartesianPoint([length, 0]);
    const point3 = new localIfcApi.IFC4.IfcCartesianPoint([length, width]);
    const point4 = new localIfcApi.IFC4.IfcCartesianPoint([0, width]);
    const polyline = new localIfcApi.IFC4.IfcPolyline([point1, point2, point3, point4, point1]);
    localIfcApi.WriteLine(modelID, polyline);

    const profile = new localIfcApi.IFC4.IfcArbitraryClosedProfileDef(localIfcApi.IFC4.IfcProfileTypeEnum.AREA, el.name, polyline);
    localIfcApi.WriteLine(modelID, profile);

    const extrudeDirection = new localIfcApi.IFC4.IfcDirection([0, 0, 1]);
    const extrudePlacement = new localIfcApi.IFC4.IfcAxis2Placement3D(new localIfcApi.IFC4.IfcCartesianPoint([currentX, 0, 0]), axis, refDirection);
    const solid = new localIfcApi.IFC4.IfcExtrudedAreaSolid(profile, extrudePlacement, extrudeDirection, height);
    localIfcApi.WriteLine(modelID, solid);

    const shapeRep = new localIfcApi.IFC4.IfcShapeRepresentation(null, "Body", "SweptSolid", [solid]);
    localIfcApi.WriteLine(modelID, shapeRep);
    const productRep = new localIfcApi.IFC4.IfcProductDefinitionShape(null, null, [shapeRep]);
    localIfcApi.WriteLine(modelID, productRep);

    let ifcProduct;
    const itemPlacement = new localIfcApi.IFC4.IfcLocalPlacement(localPlacement, extrudePlacement);
    localIfcApi.WriteLine(modelID, itemPlacement);

    if (el.ifcClass === "IfcDoor") {
      ifcProduct = new localIfcApi.IFC4.IfcDoor("GuidDoor" + Math.random().toString(36).substring(2,7), ownerHistory, el.name, el.type, null, itemPlacement, productRep, null, null, null, null);
    } else if (el.ifcClass === "IfcWindow") {
      ifcProduct = new localIfcApi.IFC4.IfcWindow("GuidWin" + Math.random().toString(36).substring(2,7), ownerHistory, el.name, el.type, null, itemPlacement, productRep, null, null, null, null);
    } else {
      ifcProduct = new localIfcApi.IFC4.IfcWall("GuidWall" + Math.random().toString(36).substring(2,7), ownerHistory, el.name, el.type, null, itemPlacement, productRep, null);
    }
    
    localIfcApi.WriteLine(modelID, ifcProduct);
    currentX += length + 1.0;
  });

  // 5. Exportar todo el árbol geométrico compilado en binario STEP IFC
  const data = localIfcApi.SaveModel(modelID);
  localIfcApi.CloseModel(modelID);
  
  return data;
}

const app = express();
app.use(express.json({ limit: "50mb" }));

app.post("/api/convert", express.raw({ limit: "50mb", type: "application/octet-stream" }), async (req, res) => {
  try {
    const buffer = req.body as Buffer;
    const fileNameHeader = req.headers["x-file-name"];
    const originalFileName = fileNameHeader ? decodeURIComponent(fileNameHeader as string) : "modelo.rvt";

    if (!buffer || buffer.length === 0) return res.status(400).json({ error: "Archivo vacío." });

    const metadata = extractRevitMetadata(buffer, originalFileName);

    const sampleSize = Math.min(buffer.length, 1 * 1024 * 1024);
    const textDump = buffer.subarray(0, sampleSize).toString("utf8").replace(/[^\x20-\x7E\s]/g, "");

    let elements = [];
    if (process.env.GOOGLE_API_KEY) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Analiza el volcado de texto de este archivo de Revit e identifica los objetos constructivos principales (muros, puertas, ventanas). 
          Devuelve estrictamente un arreglo JSON limpio sin comentarios explicativos de ningún tipo. Para cada objeto infiere o busca dimensiones aproximadas lógicas en metros (Ej: un muro largo de 4.0, espesor 0.3, altura 3.0).
          Esquema obligatorio:
          [{ "id": "1", "name": "Muro Exterior", "ifcClass": "IfcWall", "type": "Hormigon", "properties": { "Dimensiones": { "Largo": "5.0", "Espesor": "0.3", "Altura": "2.8" } } }]
          
          Texto:
          ${textDump.substring(0, 25000)}`,
          generationConfig: {
            responseMimeType: "application/json"
          }
        });

        let rawText = (response.text || "[]").trim();
        if (rawText.startsWith("```")) {
          rawText = rawText.replace(/^```(json)?/, "").replace(/```$/, "").trim();
        }
        
        elements = JSON.parse(rawText);
      } catch (aiError) {
        console.error("Error con la API de Gemini:", aiError);
      }
    }

    const ifcData = await generateReal3DIFC(metadata.projectName, elements);
    const conversionId = Math.random().toString(36).substring(2, 15);
    
    conversionStorage.set(conversionId, {
      filename: `${metadata.projectName}.ifc`,
      content: ifcData,
      metadata,
      elements
    });

    res.json({ id: conversionId, metadata, elements });
  } catch (error: any) {
    console.error("Error en el servidor:", error);
    res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
});

const publicPath = path.join(__dirname);
app.use(express.static(publicPath));

app.get("*", (req, res) => {
  const indexPath = path.join(publicPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Frontend no encontrado en dist/. Asegúrate de que 'vite build' se completó.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor híbrido corriendo en el puerto ${PORT}`);
});
