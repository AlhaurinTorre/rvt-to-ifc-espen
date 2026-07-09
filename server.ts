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
  
  // SOLUCIÓN FINAL PARA EL PROBLEMÓN DEL WASM:
  // Construimos la ruta absoluta al archivo .wasm dentro de node_modules en Render
  const rootDir = process.cwd();
  const wasmFilePath = path.join(rootDir, "node_modules", "web-ifc", "web-ifc-node.wasm");

  if (!fs.existsSync(wasmFilePath)) {
    throw new Error(`No se encontró el archivo WASM en la ruta: ${wasmFilePath}`);
  }

  // Interceptamos la inicialización inyectándole la función que exige el motor Emscripten de web-ifc
  // Esto previene el error "Module.locateFile is not a function" de forma absoluta.
  localIfcApi.wasmModule = {
    locateFile: () => wasmFilePath
  };
  
  // Inicializar el módulo web-ifc (ahora leerá la ruta absoluta que le indicamos arriba)
  await localIfcApi.Init();
  
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
      ifcProduct =
