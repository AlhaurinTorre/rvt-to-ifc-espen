import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
// Volvemos a la importación oficial estándar que exporta el paquete
import IfcAPI from "web-ifc";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || "" });
const conversionStorage = new Map<string, { filename: string; content: Uint8Array; metadata: any; elements: any[] }>();
// Declaramos la variable globalmente pero sin inicializarla aún
let ifcApi: any = null;

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

// NUEVO MOTOR GEOMÉTRICO 3D (Genera sólidos reales usando web-ifc)
function generateReal3DIFC(projectName: string, elements: any[]): Uint8Array {
  // Aseguramos el motor localmente para que nunca sea null
  const IfcConstructor = IfcAPI.IfcAPI || (IfcAPI as any);
  const localIfcApi = new IfcConstructor();
  localIfcApi.SetWasmPath("./node_modules/web-ifc/");
  
  // 1. Crear un modelo IFC en blanco en la memoria del servidor
  const modelID = localIfcApi.CreateModel();

  // 2. Definir unidades básicas (Metros)
  const lengthUnit = new IfcAPI.IFC4.IfcSIUnit(IfcAPI.IFC4.IfcSUnitEnum.LENGTHUNIT, null, IfcAPI.IFC4.IfcSIPrefix.NONE, IfcAPI.IFC4.IfcSIUnitName.METRE);
  const unitAssignment = new IfcAPI.IFC4.IfcUnitAssignment([lengthUnit]);
  
  // 3. Crear el proyecto raíz, sitio y edificio reales en la base de datos geométrica
  const ownerHistory = new IfcAPI.IFC4.IfcOwnerHistory(null, null, null, IfcAPI.IFC4.IfcChangeActionEnum.ADDED, null, null, null, Math.floor(Date.now() / 1000));
  const project = new IfcAPI.IFC4.IfcProject("3Gz8vA$7PB2v1rX6$Raaaaa", ownerHistory, projectName, "Convertido por IA con Geometria Real", null, null, null, null, unitAssignment);
  localIfcApi.WriteLine(modelID, project);

  const site = new IfcAPI.IFC4.IfcSite("2B$9zC_8PD3w2sZ8$Taaaaa", ownerHistory, "Parcela", "Coordenadas base", null, null, null, null, IfcAPI.IFC4.IfcElementCompositionEnum.ELEMENT, null, null, null, null, null);
  localIfcApi.WriteLine(modelID, site);

  const building = new IfcAPI.IFC4.IfcBuilding("1Xy9zB$8PC3w2sY7$Saaaaa", ownerHistory, "Edificio Generado", "Estructura 3D", null, null, null, null, IfcAPI.IFC4.IfcElementCompositionEnum.ELEMENT, null, null, null);
  localIfcApi.WriteLine(modelID, building);

  // Posicionamiento geométrico inicial (0,0,0)
  const origin = new IfcAPI.IFC4.IfcCartesianPoint([0, 0, 0]);
  const axis = new IfcAPI.IFC4.IfcDirection([0, 0, 1]);
  const refDirection = new IfcAPI.IFC4.IfcDirection([1, 0, 0]);
  const placement = new IfcAPI.IFC4.IfcAxis2Placement3D(origin, axis, refDirection);
  const localPlacement = new IfcAPI.IFC4.IfcLocalPlacement(null, placement);
  localIfcApi.WriteLine(modelID, localPlacement);

  let currentX = 0.0; // Desplazamiento secuencial en el espacio para que los objetos no se solapen

  // 4. Mapear cada elemento detectado por la IA en un SÓLIDO 3D REAL (Extrusión paramétrica)
  elements.forEach((el) => {
    // Extraer dimensiones lógicas dictadas por la IA o usar por defecto
    const width = parseFloat(el.properties?.Dimensiones?.Espesor || el.properties?.Dimensiones?.Ancho || "0.3");
    const length = parseFloat(el.properties?.Dimensiones?.Largo || "4.0");
    const height = parseFloat(el.properties?.Dimensiones?.Altura || "3.0");

    // Crear el perfil 2D del objeto (un rectángulo en la base)
    const point1 = new IfcAPI.IFC4.IfcCartesianPoint([0, 0]);
    const point2 = new IfcAPI.IFC4.IfcCartesianPoint([length, 0]);
    const point3 = new IfcAPI.IFC4.IfcCartesianPoint([length, width]);
    const point4 = new IfcAPI.IFC4.IfcCartesianPoint([0, width]);
    const polyline = new IfcAPI.IFC4.IfcPolyline([point1, point2, point3, point4, point1]);
    localIfcApi.WriteLine(modelID, polyline);

    const profile = new IfcAPI.IFC4.IfcArbitraryClosedProfileDef(IfcAPI.IFC4.IfcProfileTypeEnum.AREA, el.name, polyline);
    localIfcApi.WriteLine(modelID, profile);

    // Crear la extrusión 3D (darle volumen hacia arriba 'height' metros)
    const extrudeDirection = new IfcAPI.IFC4.IfcDirection([0, 0, 1]);
    const extrudePlacement = new IfcAPI.IFC4.IfcAxis2Placement3D(new IfcAPI.IFC4.IfcCartesianPoint([currentX, 0, 0]), axis, refDirection);
    const solid = new IfcAPI.IFC4.IfcExtrudedAreaSolid(profile, extrudePlacement, extrudeDirection, height);
    localIfcApi.WriteLine(modelID, solid);

    // Definir representación geométrica del elemento
    const shapeRep = new IfcAPI.IFC4.IfcShapeRepresentation(null, "Body", "SweptSolid", [solid]);
    localIfcApi.WriteLine(modelID, shapeRep);
    const productRep = new IfcAPI.IFC4.IfcProductDefinitionShape(null, null, [shapeRep]);
    localIfcApi.WriteLine(modelID, productRep);

    // Instanciar el objeto arquitectónico correspondiente según lo que descubrió la IA
    let ifcProduct;
    const itemPlacement = new IfcAPI.IFC4.IfcLocalPlacement(localPlacement, extrudePlacement);
    localIfcApi.WriteLine(modelID, itemPlacement);

    if (el.ifcClass === "IfcDoor") {
      ifcProduct = new IfcAPI.IFC4.IfcDoor("GuidDoor" + Math.random().toString(36).substring(2,7), ownerHistory, el.name, el.type, null, itemPlacement, productRep, null, null, null, null);
    } else if (el.ifcClass === "IfcWindow") {
      ifcProduct = new IfcAPI.IFC4.IfcWindow("GuidWin" + Math.random().toString(36).substring(2,7), ownerHistory, el.name, el.type, null, itemPlacement, productRep, null, null, null, null);
    } else {
      // Por defecto creamos un muro estructural geométrico real
      ifcProduct = new IfcAPI.IFC4.IfcWall("GuidWall" + Math.random().toString(36).substring(2,7), ownerHistory, el.name, el.type, null, itemPlacement, productRep, null);
    }
    
    localIfcApi.WriteLine(modelID, ifcProduct);
    currentX += length + 1.0; // Separamos el siguiente objeto un metro para que se vea claro en el visor BIM
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

    // Usamos el volcado parcial de datos binarios para que Gemini extraiga las entidades y dimensiones lógicas
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

        // Corrección de la línea que fallaba (Línea 155): Limpieza segura del JSON devuelto por Gemini
        let rawText = (response.text || "[]").trim();
        if (rawText.startsWith("```")) {
          rawText = rawText.replace(/^```(json)?/, "").replace(/```$/, "").trim();
        }
        
        elements = JSON.parse(rawText);
      } catch (aiError) {
        console.error("Error con la API de Gemini:", aiError);
      }
    }

    const ifcData = generateReal3DIFC(metadata.projectName, elements);
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

// Servir los archivos estáticos de React (Vite los deja en la raíz de 'dist')
const publicPath = path.join(__dirname);
app.use(express.static(publicPath));

// Cualquier petición que no vaya a /api/convert cargará tu aplicación de React
app.get("*", (req, res) => {
  const indexPath = path.join(publicPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Frontend no encontrado en dist/. Asegúrate de que 'vite build' se completó.");
  }
});

// Escuchar el puerto asignado por Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor híbrido corriendo en el puerto ${PORT}`);
});
