export type {
  ItemType,
  FileType,
  FileTarget,
  RegistryItemDimensions,
  RegistryItemPreview,
  RegistryItemEngine,
  RegistryItemKind,
  RegistryItemLibrarySection,
  RegistryVisualComponent,
  RegistryVisualComponentAi,
  RegistryVisualComponentCategory,
  RegistryVisualComponentSurface,
  RegistryMotionPreset,
  RegistryMotionPresetAnchor,
  RegistryMotionPresetCategory,
  RegistryMotionPresetKeyframe,
  RegistryMotionPresetTarget,
  RegistryItemSource,
  RegistryVariable,
  RegistryVariableUpdate,
  RegistryItem,
  ExampleItem,
  BlockItem,
  ComponentItem,
  RegistryManifestEntry,
  RegistryManifest,
  BlockCategory,
  BlockCategoryMeta,
  BlockParam,
} from "./types.js";

export type {
  ParsedVisualComponentData,
  RegistryVisualComponentDataBinding,
  RegistryVisualComponentDataColumn,
  RegistryVisualComponentDataColumnRole,
  RegistryVisualComponentDataColumnType,
  RegistryVisualComponentDataContract,
  RegistryVisualComponentDataEncoding,
  RegistryVisualComponentDataKind,
  RegistryVisualComponentValueFormat,
  VisualComponentDataCell,
  VisualComponentDataDocument,
  VisualComponentDataIssue,
  VisualComponentDataRow,
} from "./componentData.js";

export {
  createVisualComponentDataRow,
  formatVisualComponentDataForAi,
  parseVisualComponentData,
  serializeVisualComponentData,
} from "./componentData.js";

export {
  ITEM_TYPES,
  FILE_TYPES,
  ITEM_TYPE_DIRS,
  VISUAL_COMPONENT_CATEGORIES,
  BLOCK_CATEGORIES,
  resolveBlockCategory,
  resolveRegistryItemKind,
  isExampleItem,
  isBlockItem,
  isComponentItem,
} from "./types.js";

export type {
  GsapOfficialCapability,
  GsapOfficialCapabilityGroup,
  GsapOfficialCapabilityKind,
  GsapOfficialCapabilityRole,
} from "./gsapCapabilities.js";

export { GSAP_OFFICIAL_CAPABILITIES, GSAP_OFFICIAL_VERSION } from "./gsapCapabilities.js";
export { resolveGsapRegistryItemEngine } from "./gsapRuntime.js";
