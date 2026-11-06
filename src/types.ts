export interface Settings {
  layout: 'compact' | 'comfortable' | 'large';
  startNumber: number;
  showNumbers: boolean;
  showCheckboxes: boolean;
  showText: boolean;
  documentTitle: string;
}
export type Theme = 'light' | 'dark' | 'system';
export interface Project { codes: string[]; settings: Settings }
export interface Session extends Project { theme: Theme; input?: string }
export interface FileResult { canceled: boolean; path?: string; count?: number; project?: Project }
export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'unsupported';
  currentVersion: string;
  currentDisplayVersion?: string;
  availableVersion?: string;
  availableDisplayVersion?: string;
  progress?: number;
  message?: string;
  canAutoUpdate: boolean;
  releaseUrl: string;
  lastCheckedAt?: string;
}
export interface DesktopApi {
  getAppInfo(): Promise<{version: string; displayVersion?: string; platform: string; logoDataUrl: string}>;
  loadSession(): Promise<Session | null>;
  saveSession(session: Session): Promise<boolean>;
  exportPdf(project: Project): Promise<FileResult>;
  print(project: Project): Promise<FileResult>;
  exportImages(project: Project): Promise<FileResult>;
  saveProject(project: Project): Promise<FileResult>;
  openProject(): Promise<FileResult>;
  readClipboard(): Promise<string>;
  getUpdateState?(): Promise<UpdateState>;
  checkForUpdates?(): Promise<UpdateState>;
  downloadUpdate?(): Promise<UpdateState>;
  installUpdate?(): Promise<void>;
  onUpdateState?(callback: (state: UpdateState) => void): () => void;
  openReleasePage?(): Promise<void>;
}
declare global { interface Window { phonegest?: DesktopApi } }
