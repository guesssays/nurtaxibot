export interface BroadcastPhoto {
  fileId: string;
  fileUniqueId: string;
  fileSize?: number;
  caption?: string | null;
}

export interface BroadcastVideo {
  fileId: string;
  fileUniqueId: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number;
  caption?: string | null;
}

export interface BroadcastDocument {
  fileId: string;
  fileUniqueId: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number;
  caption?: string | null;
}
