// Types for library.mjs, which tests/launcher-library.test.ts imports directly. The launcher itself stays
// plain .mjs so the portable release runs it with bare Node.js.
export type LibraryLayout = "data" | "checkout";
export type LibraryLocation = { layout: LibraryLayout; dataDirectory: string; storageDirectory: string; envFile: string; databasePath: string };
export type LibraryEntry = { dataDirectory: string; layout: LibraryLayout };
export type LauncherConfig = { version: number; current: LibraryEntry | null; legacy: Array<LibraryEntry & { retiredAt: string }>; lastVersion: string | null };
export type BundledTools = { directory: string | null; ytdlp?: string; ffmpeg?: string; ffprobe?: string; chromium?: string };

export declare const DATABASE_FILENAME: string;
export declare const DATA_ENV_FILENAME: string;
export declare function libraryLocation(directory: string, layout: LibraryLayout): LibraryLocation;
export declare function detectLibrary(directory: string): LibraryLocation | null;
export declare function defaultDataDirectory(home?: string): string;
export declare function launcherConfigPath(platform?: NodeJS.Platform, env?: NodeJS.Dict<string>, home?: string): string;
export declare function readLauncherConfig(configPath: string): LauncherConfig;
export declare function writeLauncherConfig(configPath: string, config: LauncherConfig): void;
export declare function selectLibrary(config: LauncherConfig, location: LibraryLocation): LauncherConfig;
export declare function samePath(a: string, b: string, platform?: NodeJS.Platform): boolean;
export declare function isInside(parent: string, child: string): boolean;
export declare function readEnvFile(filePath: string | null | undefined): Record<string, string>;
export declare function serverEnvironment(input: { baseEnv: NodeJS.Dict<string>; location: LibraryLocation; appDir: string; runtimeDir: string; tools: BundledTools; host: string; port: number }): NodeJS.Dict<string>;
