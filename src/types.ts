import type { LanguagePreference } from "./i18n";

export type Term = {
  Id: string;
  Raw: string;
  Base: string;
  Key: string;
  Kind: string;
  Weight: number;
  Weighted: boolean;
  Editable: boolean;
  Start: number;
  Length: number;
  BaseStart: number;
  BaseLength: number;
  Group: string | null;
  Previous: string | null;
  Next: string | null;
};
export type Group = {
  Id: string;
  Name: string;
  Category: string;
  Description: string | null;
  Members: string[];
};
export type Workspace = {
  Text: string;
  Active: Term[];
  Hidden: Term[];
  Groups: Group[];
  Layout: string[];
  Caret: number;
  SelectionEnd?: number;
  Scroll: number;
  ParsedText: string | null;
  Natural?: { Start: number; Length: number }[];
};
export type EditingState = {
  Positive: Workspace;
  Negative: Workspace;
  IsNegative: boolean;
};
export type Snapshot = {
  Id: string;
  Name: string;
  Created: string;
  State: EditingState;
  Generation?: Generation;
  ComfyGroupTargets?: Record<string, string> | null;
};
export type Project = {
  Id?: string;
  ComfyGroupTargets?: Record<string, string>;
  Version: number;
  ParserVersion: number;
  State: EditingState;
  Snapshots: Snapshot[];
};
export type Favorite = {
  Id: string;
  Name: string;
  Text: string;
  Category: string;
  Images: string[];
};
export type Settings = {
  Step: number;
  AutoLoad: boolean;
  Topmost: boolean;
  Compact: boolean;
  GenerationNotifications?: boolean;
  AutoCollapseNewGroups: boolean;
  LoraCopyIncludeDirectory: boolean;
  LoraCopyIncludeExtension: boolean;
  ThemeColor: string;
  ThemeMode?: "light" | "dark" | "system";
  Language?: LanguagePreference;
  FontFamily?: string;
  BackgroundImage: string | null;
  BackgroundOpacity: number;
  BackgroundBlur: number;
  CollapsedGroups: string[];
  Excel: string | null;
  RecentProjects: string[];
  Width: number;
  Height: number;
  NormalWidth: number;
  NormalHeight: number;
  Left: number;
  Top: number;
  Maximized: boolean;
};
export type LoraEntry = {
  name: string;
  strength: number;
  clipStrength: number;
  active: boolean;
};
export type Loader = {
  enabled: boolean;
  node_id: string;
  node_type: string;
  model: string;
  weight_dtype: string;
  loras: LoraEntry[];
};
export type Generation = {
  enabled: boolean;
  seed: number;
  seed_control: string;
  steps: number;
  cfg: number;
  sampler: string;
  width: number;
  height: number;
  batch_size: number;
  groups: { name: string; enabled: boolean; bypasser_id: string }[];
  model_controls: { lora: Loader; unet: Loader; vae: Loader };
};
export type Lexeme = {
  Text: string;
  Key: string;
  Translation: string;
  Count: number;
  Source: string;
};
export type AppData = {
  project: Project;
  settings: Settings;
  generation: Generation;
  favorites: Favorite[];
  presets: { Name: string; Width: number; Height: number }[];
  canUndo: boolean;
  canRedo: boolean;
  valid: boolean;
  error: string | null;
  errorOffset: number;
  projectPath: string | null;
  dirty: boolean;
  dataDirectory: string;
  errors: string[];
  sessionRestoreError: string | null;
  generationError: string | null;
  matches: Record<string, Lexeme>;
  bridge: {
    port: number;
    lastRead: string | null;
    error: string | null;
    comfyUrl: string;
    comfyConnected: boolean;
    workflowRead: boolean;
    comfyError: string | null;
  };
  lexicon: {
    path: string | null;
    positive: number;
    negative: number;
    size: number;
    changed: boolean;
  };
};
export type Builtin = {
  Id: string;
  Name: string;
  English: string;
  Category: string;
  Subcategory: string;
  Text: string;
  Appearance: string;
  Notes: string;
  Source: string;
  SourceData: string;
  Modified: boolean;
  Starred: boolean;
  LastUsed: number;
};
export type LoraAsset = {
  Id: string;
  FilePath: string;
  Root: string;
  ModelKey: string;
  Name: string;
  Aliases: string;
  Series: string;
  BaseModel: string;
  Tags: string[];
  Triggers: string;
  Notes: string;
  Strength: number;
  ClipStrength: number;
  Favorite: boolean;
  Missing: boolean;
  Edited: boolean;
  PreviewChecked: boolean;
  Size: number;
  Images: string[];
  SourceImages: string[];
  Links: string[];
};
export const categories = [
  "Quality",
  "Artist",
  "Character",
  "Clothing",
  "Pose",
  "Background",
  "Scene",
  "Extra",
];
export const builtinCategories = [
  "角色",
  "画师",
  "服装组合",
  "单件服饰",
  "姿势",
  "背景",
  "场景",
  "基础词池",
  "典型组合",
  "颜色搭配",
  "其他",
];
