import React, { useState, useEffect, useRef } from "react";
import { Grid, RotateCcw, Box, Layers, HelpCircle } from "lucide-react";

interface BIMElement {
  id: string;
  name: string;
  category: string;
  ifcClass: string;
  family: string;
  type: string;
  properties: any;
  geometry?: {
    type: string;
    dimensions: number[];
    position: number[];
    color: string;
  };
}

interface BIM3DViewportProps {
  elements: BIMElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  lang: "es" | "en";
}

export default function BIM3DViewport({
  elements,
  selectedElementId,
  onSelectElement,
  lang
}: BIM3DViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // View parameters
  const [zoom, setZoom] = useState(35);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [rotationX, setRotationX] = useState(0.6); // pitch (vertical rotation)
  const [rotationZ, setRotationZ] = useState(0.8); // yaw (horizontal rotation)
  
  // Render options
  const [showGrid, setShowGrid] = useState(true);
  const [renderMode, setRenderMode] = useState<"solid" | "wireframe">("solid");
  
  // Interactive hover tracking
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  
  // Mouse drag states
  const isDraggingRef = useRef(false);
  const isPanningRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastOffsetsRef = useRef({ x: 0, y: 0 });
  const lastRotationsRef = useRef({ x: 0, y: 0 });

  // Reset viewport to default isometric drafting angle
  const handleResetView = () => {
    setZoom(35);
    setOffsetX(0);
    setOffsetY(0);
    setRotationX(0.6);
    setRotationZ(0.8);
  };

  // Helper to check if a 2D point is inside a polygon
  function isPointInPolygon(px: number, py: number, poly: { x: number; y: number }[]) {
    let isInside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      
      const intersect = ((yi > py) !== (yj > py))
          && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) isInside = !isInside;
    }
    return isInside;
  }

  // 3D Point projection to 2D screen coordinates
  function project(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number
  ) {
    // 1. Rotate around Z-axis (yaw)
    const cosZ = Math.cos(rotationZ);
    const sinZ = Math.sin(rotationZ);
    const rx = x * cosZ - y * sinZ;
    const ry = x * sinZ + y * cosZ;

    // 2. Rotate around X-axis (pitch)
    const cosX = Math.cos(rotationX);
    const sinX = Math.sin(rotationX);
    const rz = ry * sinX + z * cosX;
    
    // Depth for painter's sorting algorithm
    const depth = ry * cosX - z * sinX;

    // 3. Translate to screen space with scale (zoom) and offset (panning)
    const screenX = w / 2 + rx * zoom + offsetX;
    const screenY = h / 2 - rz * zoom + offsetY;

    return { x: screenX, y: screenY, depth };
  }

  // Mouse handlers for dragging/panning
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    isPanningRef.current = e.shiftKey || e.button === 1; // Shift or Middle click for panning
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastOffsetsRef.current = { x: offsetX, y: offsetY };
    lastRotationsRef.current = { x: rotationX, y: rotationZ };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    if (isDraggingRef.current) {
      if (isPanningRef.current) {
        // Panning: adjust translations
        setOffsetX(lastOffsetsRef.current.x + dx);
        setOffsetY(lastOffsetsRef.current.y + dy);
      } else {
        // Rotating: adjust angles
        // Pitch limit: keep it between 0.1 and 1.4 to avoid spinning upsidedown
        const nextRotX = Math.max(0.1, Math.min(1.4, lastRotationsRef.current.x + dy * 0.005));
        const nextRotZ = lastRotationsRef.current.y - dx * 0.005;
        setRotationX(nextRotX);
        setRotationZ(nextRotZ);
      }
    } else {
      // Hover hit-testing when not dragging
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const hitElementId = performHitTest(mouseX, mouseY);
      if (hitElementId !== hoveredElementId) {
        setHoveredElementId(hitElementId);
      }
    }
  };

  const handleMouseUpOrLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current) {
      const dx = Math.abs(e.clientX - dragStartRef.current.x);
      const dy = Math.abs(e.clientY - dragStartRef.current.y);
      
      // If movement is extremely small, treat as a single click / select
      if (dx < 3 && dy < 3 && e.type === "mouseup") {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const clickedElementId = performHitTest(mouseX, mouseY);
          onSelectElement(clickedElementId);
        }
      }
    }
    isDraggingRef.current = false;
    isPanningRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    // Zoom limits: 5x to 150x
    const zoomDelta = e.deltaY < 0 ? 3 : -3;
    setZoom(prev => Math.max(5, Math.min(150, prev + zoomDelta)));
  };

  // Perform 2D raycasting checks on all projected faces (front-most wins)
  function performHitTest(mouseX: number, mouseY: number): string | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const w = canvas.width;
    const h = canvas.height;

    const faces = buildProjectedFaces(w, h);
    
    // Sort faces so front-most faces (smallest depth) are checked first
    faces.sort((a, b) => a.depth - b.depth);

    for (const face of faces) {
      if (isPointInPolygon(mouseX, mouseY, face.screenPoints)) {
        return face.elementId;
      }
    }
    return null;
  }

  // Build and project all 3D element faces into screen space
  function buildProjectedFaces(w: number, h: number) {
    const list: any[] = [];

    elements.forEach(el => {
      if (!el.geometry) return;
      const { type, dimensions, position, color } = el.geometry;
      const [px, py, pz] = position;

      let dx = dimensions[0] / 2;
      let dy = dimensions[1] / 2;
      let dz = dimensions[2] / 2;

      // Define local 8 cuboid vertices around center
      let vertices: number[][];
      
      if (type === "wall") {
        // Walls: stretched along X-axis
        vertices = [
          [px - dx, py - dy, pz],
          [px + dx, py - dy, pz],
          [px + dx, py + dy, pz],
          [px - dx, py + dy, pz],
          [px - dx, py - dy, pz + dz * 2],
          [px + dx, py - dy, pz + dz * 2],
          [px + dx, py + dy, pz + dz * 2],
          [px - dx, py + dy, pz + dz * 2],
        ];
      } else if (type === "slab") {
        // Slab base plate at floor height
        vertices = [
          [px - dx, py - dy, pz],
          [px + dx, py - dy, pz],
          [px + dx, py + dy, pz],
          [px - dx, py + dy, pz],
          [px - dx, py - dy, pz + dz * 2],
          [px + dx, py - dy, pz + dz * 2],
          [px + dx, py + dy, pz + dz * 2],
          [px - dx, py + dy, pz + dz * 2],
        ];
      } else if (type === "plane") {
        // RFA Reference plane: flat surface sheet
        vertices = [
          [px - dx, py - dy, pz],
          [px + dx, py - dy, pz],
          [px + dx, py + dy, pz],
          [px - dx, py + dy, pz],
          [px - dx, py - dy, pz + 0.01],
          [px + dx, py - dy, pz + 0.01],
          [px + dx, py + dy, pz + 0.01],
          [px - dx, py + dy, pz + 0.01],
        ];
      } else {
        // Default Box, door, window, column: standard extrusion
        vertices = [
          [px - dx, py - dy, pz],
          [px + dx, py - dy, pz],
          [px + dx, py + dy, pz],
          [px - dx, py + dy, pz],
          [px - dx, py - dy, pz + dz * 2],
          [px + dx, py - dy, pz + dz * 2],
          [px + dx, py + dy, pz + dz * 2],
          [px - dx, py + dy, pz + dz * 2],
        ];
      }

      // Project vertices to screen coordinates
      const projectedVerts = vertices.map(v => project(v[0], v[1], v[2], w, h));

      // Defining the 6 faces with index markers
      const faceIndices = [
        { indices: [0, 1, 5, 4], norm: "S" }, // Front
        { indices: [1, 2, 6, 5], norm: "E" }, // Right
        { indices: [2, 3, 7, 6], norm: "N" }, // Back
        { indices: [3, 0, 4, 7], norm: "W" }, // Left
        { indices: [4, 5, 6, 7], norm: "U" }, // Top
        { indices: [3, 2, 1, 0], norm: "D" }, // Bottom
      ];

      faceIndices.forEach(face => {
        const screenPoints = face.indices.map(i => projectedVerts[i]);
        
        // Face center depth for sorting
        const depth = screenPoints.reduce((acc, pt) => acc + pt.depth, 0) / 4;

        list.push({
          elementId: el.id,
          screenPoints,
          depth,
          norm: face.norm,
          color,
          elName: el.name,
          elClass: el.ifcClass
        });
      });
    });

    return list;
  }

  // Animation render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle container sizing
    const handleResize = () => {
      const container = containerRef.current;
      if (!container) return;
      canvas.width = container.clientWidth;
      canvas.height = Math.max(380, container.clientHeight);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    const w = canvas.width;
    const h = canvas.height;

    // Clear Canvas
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";

    // 1. Draw grid floor base at Z = 0
    if (showGrid) {
      ctx.lineWidth = 1;
      const gridSize = 10;
      const step = 1.0; // every 1 meter
      
      // Draw grid lines
      for (let i = -gridSize; i <= gridSize; i++) {
        // Lines parallel to Y axis
        const p1 = project(i * step, -gridSize * step, 0, w, h);
        const p2 = project(i * step, gridSize * step, 0, w, h);
        ctx.strokeStyle = i === 0 ? "rgba(239, 68, 68, 0.4)" : "#e2e8f0"; // Red line for X-axis center
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Lines parallel to X axis
        const p3 = project(-gridSize * step, i * step, 0, w, h);
        const p4 = project(gridSize * step, i * step, 0, w, h);
        ctx.strokeStyle = i === 0 ? "rgba(34, 197, 94, 0.4)" : "#e2e8f0"; // Green line for Y-axis center
        ctx.beginPath();
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.stroke();
      }

      // Draw Z axis center vertical indicator
      const zBottom = project(0, 0, -2, w, h);
      const zTop = project(0, 0, 4, w, h);
      ctx.strokeStyle = "rgba(59, 130, 246, 0.4)"; // Blue line for Z-axis
      ctx.beginPath();
      ctx.moveTo(zBottom.x, zBottom.y);
      ctx.lineTo(zTop.x, zTop.y);
      ctx.stroke();
    }

    // 2. Build, Sort and Render 3D model faces (Painter's Algorithm)
    const faces = buildProjectedFaces(w, h);
    
    // Sort faces back-to-front (largest depth first)
    faces.sort((a, b) => b.depth - a.depth);

    faces.forEach(face => {
      const isSelected = selectedElementId === face.elementId;
      const isHovered = hoveredElementId === face.elementId;

      ctx.beginPath();
      ctx.moveTo(face.screenPoints[0].x, face.screenPoints[0].y);
      for (let i = 1; i < face.screenPoints.length; i++) {
        ctx.lineTo(face.screenPoints[i].x, face.screenPoints[i].y);
      }
      ctx.closePath();

      if (renderMode === "solid") {
        // Calculate basic architectural shading light multipliers
        let lightFactor = 1.0;
        if (face.norm === "U") lightFactor = 1.15; // Sun light from top
        if (face.norm === "S" || face.norm === "E") lightFactor = 1.0;
        if (face.norm === "N" || face.norm === "W") lightFactor = 0.82; // Shadows on backside
        if (face.norm === "D") lightFactor = 0.65; // Bottom shadow

        // Convert base hex color to tinted RGB
        let fillStyle = face.color;
        if (fillStyle.startsWith("#")) {
          const r = parseInt(fillStyle.substring(1, 3), 16);
          const g = parseInt(fillStyle.substring(3, 5), 16);
          const b = parseInt(fillStyle.substring(5, 7), 16);
          
          let nr = Math.min(255, Math.max(0, Math.round(r * lightFactor)));
          let ng = Math.min(255, Math.max(0, Math.round(g * lightFactor)));
          let nb = Math.min(255, Math.max(0, Math.round(b * lightFactor)));

          if (isSelected) {
            // Gold overlay for selected elements
            nr = Math.round(nr * 0.4 + 245 * 0.6);
            ng = Math.round(ng * 0.4 + 158 * 0.6);
            nb = Math.round(nb * 0.4 + 11 * 0.6);
          } else if (isHovered) {
            // White highlight overlay for hover
            nr = Math.min(255, nr + 40);
            ng = Math.min(255, ng + 40);
            nb = Math.min(255, nb + 40);
          }

          fillStyle = `rgb(${nr}, ${ng}, ${nb})`;
        }

        ctx.fillStyle = fillStyle;
        ctx.fill();
      }

      // Draw outlines for technical drafting look
      ctx.lineWidth = isSelected ? 2.5 : (isHovered ? 1.5 : 0.8);
      ctx.strokeStyle = isSelected 
        ? "#eab308" // Gold selected outline
        : (isHovered ? "#3b82f6" : "rgba(30, 41, 59, 0.15)"); // Slate outlines
      ctx.stroke();
    });

    // 3. Draw Compass / Axes Gizmo in bottom left corner
    const gizmoX = 50;
    const gizmoY = h - 55;
    const gizmoSize = 25;

    // Standard coordinate positions
    const axes = [
      { x: 1, y: 0, z: 0, label: "X", color: "#ef4444" },
      { x: 0, y: 1, z: 0, label: "Y", color: "#22c55e" },
      { x: 0, y: 0, z: 1, label: "Z", color: "#3b82f6" }
    ];

    axes.forEach(axis => {
      // Rotate directions using current rotations
      const cosZ = Math.cos(rotationZ);
      const sinZ = Math.sin(rotationZ);
      const rx = axis.x * cosZ - axis.y * sinZ;
      const ry = axis.x * sinZ + axis.y * cosZ;

      const cosX = Math.cos(rotationX);
      const sinX = Math.sin(rotationX);
      const rz = ry * sinX + axis.z * cosX;

      const screenX = gizmoX + rx * gizmoSize;
      const screenY = gizmoY - rz * gizmoSize;

      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = axis.color;
      ctx.moveTo(gizmoX, gizmoY);
      ctx.lineTo(screenX, screenY);
      ctx.stroke();

      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = axis.color;
      ctx.fillText(axis.label, screenX + (rx >= 0 ? 3 : -7), screenY + (rz >= 0 ? -3 : 7));
    });

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [elements, selectedElementId, hoveredElementId, zoom, offsetX, offsetY, rotationX, rotationZ, showGrid, renderMode]);

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-inner relative flex flex-col min-h-[420px]" ref={containerRef}>
      
      {/* 3D CAD Drafting Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onWheel={handleWheel}
        className="w-full flex-1 rounded-xl cursor-grab active:cursor-grabbing bg-white border border-slate-100"
        style={{ touchAction: "none" }}
      />

      {/* BIM Viewer Controls Overlay */}
      <div className="absolute top-7 right-7 flex flex-col gap-2 bg-white/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-sm z-20">
        
        {/* Reset View */}
        <button
          onClick={handleResetView}
          className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition"
          title={lang === "es" ? "Restablecer cámara isométrica" : "Reset isometric camera"}
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Toggle Grid */}
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1.5 rounded-lg transition ${
            showGrid ? "bg-blue-50 text-blue-600" : "hover:bg-slate-100 text-slate-600"
          }`}
          title={lang === "es" ? "Mostrar/Ocultar rejilla" : "Show/Hide grid"}
        >
          <Grid className="w-4 h-4" />
        </button>

        {/* Toggle Wireframe / Solid */}
        <button
          onClick={() => setRenderMode(m => m === "solid" ? "wireframe" : "solid")}
          className={`p-1.5 rounded-lg transition ${
            renderMode === "wireframe" ? "bg-blue-50 text-blue-600" : "hover:bg-slate-100 text-slate-600"
          }`}
          title={lang === "es" ? "Alternar estructura de alambre" : "Toggle wireframe mode"}
        >
          {renderMode === "wireframe" ? (
            <Layers className="w-4 h-4" />
          ) : (
            <Box className="w-4 h-4" />
          )}
        </button>

      </div>

      {/* Instructions HUD */}
      <div className="absolute bottom-6 right-6 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[10px] text-slate-300 flex items-center space-x-1.5 pointer-events-none">
        <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
        <span>
          {lang === "es" 
            ? "Arrastra para Rotar • Shift+Arrastra para Encuadrar • Rueda para Zoom"
            : "Drag to Rotate • Shift+Drag to Pan • Scroll to Zoom"
          }
        </span>
      </div>

    </div>
  );
}
