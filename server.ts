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

    const profile = new IfcAPI.IFC4.IfcArbitraryClosedProfileDef(IfcAPI.IFC4.IfcProfile
