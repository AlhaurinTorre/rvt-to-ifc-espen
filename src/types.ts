export interface ConversionItem {
  id: string;
  fileName: string;
  fileSize: string;
  status: "idle" | "uploading" | "parsing" | "converting" | "completed" | "failed";
  progress: number;
  revitVersion: string;
  author: string;
  createdAt: string;
  downloadUrl: string | null;
  logs: string[];
  fileType?: "rvt" | "rfa";
  elements?: any[];
}
