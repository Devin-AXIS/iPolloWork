export interface StoredPreviewZoomState {
  zoomPercent: number;
  panX: number;
  panY: number;
}

export type CatalogColumnCount = 1 | 2 | 3 | 4;

import { parseDockLayout } from "../components/dock/dockLayoutSchema";
import type { SerializedDockview } from "dockview-react";

export interface StudioUiPreferences {
  dockLayout?: SerializedDockview;
  thumbnailMode?: "adaptive" | "hidden";
  timelineVisible?: boolean;
  timelineHeight?: number;
  /** Width of the timeline's sticky layer-control column. */
  timelineLayerWidth?: number;
  playbackRate?: number;
  audioMuted?: boolean;
  previewZoom?: StoredPreviewZoomState;
  recentBlocks?: string[];
  snapEnabled?: boolean;
  gridVisible?: boolean;
  gridSpacing?: number;
  snapToGrid?: boolean;
  /** Timeline magnet: snap clip drags/trims/drops to playhead, clip edges, and beats. */
  timelineSnapEnabled?: boolean;
  /** Transport + ruler readout mode: timecode or frame number. */
  timeDisplayMode?: "time" | "frame";
  /**
   * Timeline zoom mode. Persisted so a zoom PINNED on the first edit survives the
   * post-edit iframe reload — otherwise the store reset to "fit" and the duration
   * change rescaled every clip (the blink-fix's rescale symptom).
   */
  timelineZoomMode?: "fit" | "manual";
  /** Manual timeline zoom percent, paired with `timelineZoomMode: "manual"`. */
  timelineManualZoomPercent?: number;
  /** Shared card density for the animation and scene catalogs. */
  catalogColumnCount?: CatalogColumnCount;
}

const STUDIO_UI_PREFERENCES_KEY = "hf-studio-ui-preferences";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// fallow-ignore-next-line complexity
function readStorage(
  storage: Storage | null,
  key = STUDIO_UI_PREFERENCES_KEY,
): StudioUiPreferences {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const preferences: StudioUiPreferences = {};
    const layout = parseDockLayout(parsed.dockLayout);
    if (layout) preferences.dockLayout = layout;
    if (
      parsed.thumbnailMode === "adaptive" ||
      parsed.thumbnailMode === "hidden"
    )
      preferences.thumbnailMode = parsed.thumbnailMode;
    if (typeof parsed.timelineVisible === "boolean") {
      preferences.timelineVisible = parsed.timelineVisible;
    }
    if (typeof parsed.timelineHeight === "number" && Number.isFinite(parsed.timelineHeight)) {
      preferences.timelineHeight = parsed.timelineHeight;
    }
    if (
      typeof parsed.timelineLayerWidth === "number" &&
      Number.isFinite(parsed.timelineLayerWidth)
    ) {
      preferences.timelineLayerWidth = parsed.timelineLayerWidth;
    }
    if (typeof parsed.playbackRate === "number" && Number.isFinite(parsed.playbackRate)) {
      preferences.playbackRate = parsed.playbackRate;
    }
    if (typeof parsed.audioMuted === "boolean") {
      preferences.audioMuted = parsed.audioMuted;
    }
    if (isRecord(parsed.previewZoom)) {
      const { zoomPercent, panX, panY } = parsed.previewZoom;
      if (
        typeof zoomPercent === "number" &&
        Number.isFinite(zoomPercent) &&
        typeof panX === "number" &&
        Number.isFinite(panX) &&
        typeof panY === "number" &&
        Number.isFinite(panY)
      ) {
        preferences.previewZoom = { zoomPercent, panX, panY };
      }
    }
    if (Array.isArray(parsed.recentBlocks)) {
      preferences.recentBlocks = parsed.recentBlocks.filter(
        (v: unknown): v is string => typeof v === "string",
      );
    }
    if (typeof parsed.snapEnabled === "boolean") {
      preferences.snapEnabled = parsed.snapEnabled;
    }
    if (typeof parsed.gridVisible === "boolean") {
      preferences.gridVisible = parsed.gridVisible;
    }
    if (typeof parsed.gridSpacing === "number" && Number.isFinite(parsed.gridSpacing)) {
      preferences.gridSpacing = parsed.gridSpacing;
    }
    if (typeof parsed.snapToGrid === "boolean") {
      preferences.snapToGrid = parsed.snapToGrid;
    }
    if (typeof parsed.timelineSnapEnabled === "boolean") {
      preferences.timelineSnapEnabled = parsed.timelineSnapEnabled;
    }
    if (parsed.timeDisplayMode === "time" || parsed.timeDisplayMode === "frame") {
      preferences.timeDisplayMode = parsed.timeDisplayMode;
    }
    if (parsed.timelineZoomMode === "fit" || parsed.timelineZoomMode === "manual") {
      preferences.timelineZoomMode = parsed.timelineZoomMode;
    }
    if (
      typeof parsed.timelineManualZoomPercent === "number" &&
      Number.isFinite(parsed.timelineManualZoomPercent)
    ) {
      preferences.timelineManualZoomPercent = parsed.timelineManualZoomPercent;
    }
    if (
      parsed.catalogColumnCount === 1 ||
      parsed.catalogColumnCount === 2 ||
      parsed.catalogColumnCount === 3 ||
      parsed.catalogColumnCount === 4
    ) {
      preferences.catalogColumnCount = parsed.catalogColumnCount;
    }
    return preferences;
  } catch {
    return {};
  }
}

function storageKeyFor(projectId: string | null, key: string) {
  return projectId ? `${key}:${projectId}` : key;
}

export function readStudioUiPreferences(
  storage: Storage | null = getBrowserStorage(),
  projectId: string | null = null,
  key: string = STUDIO_UI_PREFERENCES_KEY,
): StudioUiPreferences {
  const scoped = readStorage(storage, storageKeyFor(projectId, key));
  if (!projectId || Object.keys(scoped).length > 0) return scoped;
  return readStorage(storage, key);
}

export function writeStudioUiPreferences(
  patch: StudioUiPreferences,
  storage: Storage | null = getBrowserStorage(),
  projectId: string | null = null,
  key: string = STUDIO_UI_PREFERENCES_KEY,
) {
  if (!storage) return;
  try {
    const next = {
      ...readStudioUiPreferences(storage, projectId, key),
      ...patch,
    };
    storage.setItem(storageKeyFor(projectId, key), JSON.stringify(next));
  } catch {
    /* localStorage may be unavailable or full */
  }
}
