import {
  createContext,
  useContext,
  type ReactNode,
  type MutableRefObject,
} from "react";
import type { AppData } from "./types";
export type ConfirmOptions = {
  title: string;
  body: ReactNode;
  confirm?: string;
  cancel?: string;
  third?: string;
  danger?: boolean;
};
export type Context = {
  data: AppData;
  act: <T = any>(method: string, payload?: unknown) => Promise<T>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  reportError: (message: string) => void;
  confirm: (options: ConfirmOptions) => Promise<"confirm" | "cancel" | "third">;
  open: (page: string) => void;
  page: string;
  modal: (node: ReactNode) => void;
  flush: MutableRefObject<() => Promise<void>>;
  draftGuards: MutableRefObject<Map<string, () => Promise<boolean>>>;
  draftFlushers: MutableRefObject<Map<string, () => Promise<void>>>;
  draftRepairs: MutableRefObject<Map<string, () => Promise<void>>>;
  save: (as?: boolean) => Promise<void>;
  newProject: () => Promise<void>;
  openProject: (path?: string) => Promise<void>;
  importImage: (path?: string) => Promise<void>;
};
export const AppContext = createContext<Context>(null!);
export const useApp = () => useContext(AppContext);
