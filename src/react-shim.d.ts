declare module 'react' {
  export type ReactNode = unknown;
  export interface DragEvent<T = Element> {
    currentTarget: T;
    clientY: number;
    dataTransfer: DataTransfer;
    preventDefault(): void;
  }
  export const StrictMode: (props: { children?: ReactNode }) => unknown;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T | null): { current: T | null };
}

declare module 'react-dom/client' {
  export function createRoot(element: Element | DocumentFragment): { render(node: unknown): void };
}

declare module 'react/jsx-runtime' {
  export const Fragment: unknown;
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
}

declare module 'lucide-react' {
  type IconProps = { size?: number; className?: string; fill?: string; title?: string };
  export const Bell: (props: IconProps) => unknown;
  export const BookOpen: (props: IconProps) => unknown;
  export const Bot: (props: IconProps) => unknown;
  export const BriefcaseBusiness: (props: IconProps) => unknown;
  export const CalendarClock: (props: IconProps) => unknown;
  export const Check: (props: IconProps) => unknown;
  export const ChevronDown: (props: IconProps) => unknown;
  export const ChevronRight: (props: IconProps) => unknown;
  export const CircleUserRound: (props: IconProps) => unknown;
  export const Clipboard: (props: IconProps) => unknown;
  export const Clock3: (props: IconProps) => unknown;
  export const FileText: (props: IconProps) => unknown;
  export const Filter: (props: IconProps) => unknown;
  export const History: (props: IconProps) => unknown;
  export const GripVertical: (props: IconProps) => unknown;
  export const Home: (props: IconProps) => unknown;
  export const LayoutList: (props: IconProps) => unknown;
  export const LoaderCircle: (props: IconProps) => unknown;
  export const Mail: (props: IconProps) => unknown;
  export const Menu: (props: IconProps) => unknown;
  export const MessageSquareText: (props: IconProps) => unknown;
  export const MessagesSquare: (props: IconProps) => unknown;
  export const NotebookText: (props: IconProps) => unknown;
  export const Pencil: (props: IconProps) => unknown;
  export const Plus: (props: IconProps) => unknown;
  export const RotateCcw: (props: IconProps) => unknown;
  export const Save: (props: IconProps) => unknown;
  export const Search: (props: IconProps) => unknown;
  export const Settings: (props: IconProps) => unknown;
  export const SlidersHorizontal: (props: IconProps) => unknown;
  export const Sparkles: (props: IconProps) => unknown;
  export const Star: (props: IconProps) => unknown;
  export const Trash2: (props: IconProps) => unknown;
  export const WandSparkles: (props: IconProps) => unknown;
  export const X: (props: IconProps) => unknown;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}
